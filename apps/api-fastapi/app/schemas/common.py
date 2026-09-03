from typing import Generic, TypeVar, Optional, Any
from pydantic import BaseModel, Field

T = TypeVar("T")


class ResponseEnvelope(BaseModel, Generic[T]):
    """
    Standard Response Envelope matching NestJS backend structure:
    {
      "success": true,
      "data": { ... },
      "timestamp": "ISO-8601 UTC string",
      "requestId": "UUID string"
    }
    """

    success: bool = True
    data: Optional[T] = None
    timestamp: str = Field(description="ISO 8601 UTC timestamp")
    requestId: str = Field(description="Unique X-Request-ID header value")


class ErrorResponse(BaseModel):
    """
    Standard Error Response structure matching NestJS error layout.
    """

    statusCode: int
    message: Any  # String or list of string validation messages
    error: str
