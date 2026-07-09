from fastapi import APIRouter, HTTPException

from app.schemas.job import Job

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=Job)
def get_job(job_id: str) -> Job:
    raise HTTPException(status_code=501, detail="GET /jobs/{id} not implemented")
