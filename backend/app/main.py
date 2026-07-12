from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.integrations import storage
from app.schemas.common import ErrorBody, ErrorDetail, ErrorResponse

app = FastAPI(title="Amee API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")

# video_url / json_url / etc. (contract §4, §12) point here — storage.py is
# still the only thing that decides the actual disk layout.
storage.storage_dir().mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=storage.storage_dir()), name="files")

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
