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

# Exactly two queues, matching INVARIANTS P5. A `split` queue is designated
# future, not built — do not add a third queue here speculatively. Exchange
# and routing key are given explicitly per queue — leaving them implicit let
# both queues collapse onto the same default exchange/routing key.
celery_app.conf.task_queues = (
    Queue("transcribe", exchange="transcribe", routing_key="transcribe"),
    Queue("export", exchange="export", routing_key="export"),
)
celery_app.conf.task_default_queue = "transcribe"
