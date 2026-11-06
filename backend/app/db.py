from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from .models import Base
from .settings import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

if connect_args:
    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")


def init_db() -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    Base.metadata.create_all(bind=engine)
