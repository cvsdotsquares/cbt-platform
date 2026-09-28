from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = Field(default="ok")
    database: str = Field(default="connected")
    timestamp: str = Field(default="")
