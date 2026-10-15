"""Optional caller-supplied book; unknown and explicitly empty are distinct."""
import hashlib
from pydantic import BaseModel, ConfigDict, Field


class Position(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    ticker: str = Field(min_length=1, max_length=40)
    quantity: float
    average_price: float | None = Field(default=None, gt=0)


class PortfolioContext(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    positions: list[Position] = Field(default_factory=list, max_length=500)
    cash: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=1, max_length=12)

    def render(self):
        return 'Caller-supplied portfolio snapshot (not independently broker-verified):\n' + self.model_dump_json()

    def fingerprint(self):
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()
