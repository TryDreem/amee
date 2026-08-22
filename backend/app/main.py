import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response

from app.api.v1.router import api_router
from app.exceptions import DomainValidationError, RateLimitedError
from app.integrations import storage
from app.schemas.common import ErrorBody, ErrorDetail, ErrorResponse

app = FastAPI(title="Amee API", version="0.1.0")

# The session cookie (app/api/v1/deps.py) only works cross-origin if the browser is told this
# API trusts credentialed requests from the frontend's exact origin — the CORS spec forbids
# allow_credentials=True together with a wildcard allow_origins, so unlike every other setting
# here this can't default to "*". Same env var and same default as auth.py's _frontend_origin(),
# since a mismatch between the two would silently reintroduce this bug for one of the two paths.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("AMEE_FRONTEND_ORIGIN", "http://localhost:8001")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")

# video_url / json_url / etc. (contract §4, §12) point here — storage.py is still the only thing
# that decides the actual disk layout. One route, not an import-time mount-vs-redirect branch:
# storage.backend()/storage.storage_dir() are both read fresh per request, same "never cached"
# convention storage.py itself already uses everywhere - a module-level branch or a cached root
# path would also make this untestable within one test process, since conftest.py imports this
# module exactly once.
storage.storage_dir().mkdir(parents=True, exist_ok=True)


@app.get("/files/{path:path}", include_in_schema=False)
async def get_file(path: str) -> Response:
    if storage.backend() == "blob":
        # 302 straight to a signed Blob URL - offloads bandwidth entirely from the
        # memory-constrained API VM instead of streaming bytes through it. Cache-Control: no-store
        # matters: a cached redirect surviving past the SAS TTL would 403 from Blob instead of
        # quietly re-resolving. No existence check first - a missing blob just breaks the
        # <video>/<img> the same way a 404 would have, and costs one less round trip.
        sas_url = await storage.public_url(f"/files/{path}")
        return RedirectResponse(
            sas_url, status_code=302, headers={"Cache-Control": "no-store"}
        )
    # Manual FileResponse instead of StaticFiles: same behavior (StaticFiles.file_response()
    # just constructs a FileResponse internally - same Range-request support via the unconditional
    # accept-ranges header, same guessed media_type, no Content-Disposition either way since
    # neither call passes filename=), but reachable dynamically per-request like the blob branch
    # above, not fixed once at import time.
    files_root = storage.storage_dir().resolve()
    full_path = (files_root / path).resolve()
    if not full_path.is_relative_to(files_root) or not full_path.is_file():
        raise HTTPException(status_code=404, detail="Not Found")
    return FileResponse(full_path)


_STATUS_CODES = {
    404: "not_found",
    409: "conflict",
    422: "validation_error",
    429: "rate_limited",
    501: "not_implemented",
}


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    code = _STATUS_CODES.get(exc.status_code, "error")
    body = ErrorResponse(
        error=ErrorBody(code=code, message=str(exc.detail), details=[])
    )
    return JSONResponse(status_code=exc.status_code, content=body.model_dump())


@app.exception_handler(DomainValidationError)
async def domain_validation_exception_handler(
    request: Request, exc: DomainValidationError
) -> JSONResponse:
    body = ErrorResponse(
        error=ErrorBody(
            code="validation_error",
            message="Validation failed",
            details=exc.details,
        )
    )
    return JSONResponse(status_code=422, content=body.model_dump())


@app.exception_handler(RateLimitedError)
async def rate_limited_exception_handler(
    request: Request, exc: RateLimitedError
) -> JSONResponse:
    body = ErrorResponse(
        error=ErrorBody(
            code="rate_limited",
            message="Too many requests",
            details=[
                ErrorDetail(
                    field=exc.field, issue=f"retry after {exc.reset_seconds} seconds"
                )
            ],
        )
    )
    # api-contract.md §1's fixed 429 shape: Retry-After plus the three X-RateLimit-* headers on
    # the response that actually got rate-limited (every OTHER response carries them too, but
    # those are set by the dependency directly on its own Response object, not here).
    return JSONResponse(
        status_code=429,
        content=body.model_dump(),
        headers={
            "Retry-After": str(exc.reset_seconds),
            "X-RateLimit-Limit": str(exc.limit),
            "X-RateLimit-Remaining": str(exc.remaining),
            "X-RateLimit-Reset": str(exc.reset_seconds),
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    details = [
        ErrorDetail(field=".".join(str(part) for part in err["loc"]), issue=err["msg"])
        for err in exc.errors()
    ]
    body = ErrorResponse(
        error=ErrorBody(
            code="validation_error",
            message="Request validation failed",
            details=details,
        )
    )
    return JSONResponse(status_code=422, content=body.model_dump())
