from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from sqlalchemy.orm import Session

from app.api.common import not_found
from app.database import get_db
from app.models import Setting
from app.schemas import SettingValue

router = APIRouter(prefix="/api/settings", tags=["settings"])

KeyPath = Path(pattern=r"^[a-z0-9_.-]{1,100}$")


@router.get("")
def list_settings(db: Session = Depends(get_db)) -> dict[str, str]:
    return {setting.key: setting.value for setting in db.query(Setting).order_by(Setting.key).all()}


@router.get("/{key}", response_model=SettingValue)
def read_setting(key: str = KeyPath, db: Session = Depends(get_db)) -> SettingValue:
    setting = db.query(Setting).filter(Setting.key == key).first()
    if setting is None:
        raise not_found("Setting")
    return SettingValue(value=setting.value)


@router.put("/{key}", response_model=SettingValue)
def write_setting(payload: SettingValue, key: str = KeyPath, db: Session = Depends(get_db)) -> SettingValue:
    setting = db.query(Setting).filter(Setting.key == key).first()
    if setting is None:
        setting = Setting(key=key, value=payload.value)
        db.add(setting)
    else:
        setting.value = payload.value
    db.commit()
    return SettingValue(value=payload.value)


@router.delete("/{key}", status_code=204)
def delete_setting(key: str = KeyPath, db: Session = Depends(get_db)) -> Response:
    setting = db.query(Setting).filter(Setting.key == key).first()
    if setting is None:
        raise HTTPException(status_code=404, detail="Setting not found")
    db.delete(setting)
    db.commit()
    return Response(status_code=204)
