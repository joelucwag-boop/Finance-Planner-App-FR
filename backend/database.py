"""
Database Layer — SQLite + SQLAlchemy
Models: User, Plan, SharedLink
Auto-creates tables on import. File: finance.db in the backend directory.
"""
import os
import json
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Text, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

# Database file location (same directory as this file)
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "finance.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    display_name = Column(String(100), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    plans = relationship("Plan", back_populates="owner", cascade="all, delete-orphan")


class Plan(Base):
    __tablename__ = "plans"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(200), default="My Plan")
    inputs_json = Column(Text, nullable=False)  # JSON blob of all input parameters
    scenarios_json = Column(Text, default="[]")  # JSON array of saved scenarios
    is_default = Column(Boolean, default=False)  # User's active plan
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    owner = relationship("User", back_populates="plans")
    shared_links = relationship("SharedLink", back_populates="plan", cascade="all, delete-orphan")

    def get_inputs(self) -> dict:
        return json.loads(self.inputs_json) if self.inputs_json else {}

    def set_inputs(self, inputs: dict):
        self.inputs_json = json.dumps(inputs)

    def get_scenarios(self) -> list:
        return json.loads(self.scenarios_json) if self.scenarios_json else []

    def set_scenarios(self, scenarios: list):
        self.scenarios_json = json.dumps(scenarios)


class SharedLink(Base):
    __tablename__ = "shared_links"

    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, ForeignKey("plans.id"), nullable=False)
    token = Column(String(64), unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    views = Column(Integer, default=0)

    # Relationships
    plan = relationship("Plan", back_populates="shared_links")


# Create all tables on import
Base.metadata.create_all(bind=engine)


def get_db():
    """FastAPI dependency — yields a database session, auto-closes."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
