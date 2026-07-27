import os

from celery import Celery
from kombu import Queue

celery_app = Celery(
    "amee",
    broker=os.environ.get("CELERY_BROKER_URL", "amqp://guest:guest@localhost:5672//"),
    # So `celery -A app.workers.celery_app worker ...` (the real worker
    # process, launched by `make dev`) finds the task without a manual
    # import here — a plain module-level import would be circular, since
    # tasks.py needs `celery_app` itself to register the @task decorator.
    include=["app.workers.tasks"],
)

# Exactly two queues, matching INVARIANTS P5. The LLM smart re-splitter
# (Step 14, arch §5.3) was briefly given its own `split` queue, then
# deliberately reverted: it runs as a blocking step inside the transcribe
# job either way (the job can't reach `done` until it resolves, to avoid a
# race with the user starting to edit), so a separate queue bought no real
# concurrency — the transcribe worker slot sits occupied waiting regardless
# of which queue the LLM call physically runs on. It's a plain awaited
# function call inside `_run_transcribe` now, not a dispatched task. Do not
# add a third queue here speculatively.
celery_app.conf.task_queues = (
    Queue("transcribe", exchange="transcribe", routing_key="transcribe"),
    Queue("export", exchange="export", routing_key="export"),
)
celery_app.conf.task_default_queue = "transcribe"
