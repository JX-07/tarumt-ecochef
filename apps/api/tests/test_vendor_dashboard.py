from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from app.services.vendor_dashboard import period_bounds
NOW = datetime(2026,11,6,16,30,tzinfo=timezone.utc)


def test_today_and_monday_week_use_malaysia_boundaries():
    start,end,_=period_bounds("today",now=NOW)
    assert start.isoformat()=="2026-11-07T00:00:00+08:00"
    assert end.isoformat()=="2026-11-08T00:00:00+08:00"
    start,end,_=period_bounds("week",now=NOW)
    assert start.date().isoformat()=="2026-11-02"
    assert end.date().isoformat()=="2026-11-09"


def test_month_and_leap_year_use_whole_calendar_periods():
    start,end,label=period_bounds("month",2024,2,NOW)
    assert label=="February 2024" and (end-start).days==29
    start,end,label=period_bounds("year",2024,now=NOW)
    assert label=="2024" and (end-start).days==366


@pytest.mark.parametrize("period,year,month",[("bad",None,None),("today",2025,None),("week",None,5),("month",None,2),("month",2026,12),("year",2027,None),("year",1999,None),("year",2025,1),("month",2024,13)])
def test_invalid_and_future_reports_are_rejected(period,year,month):
    with pytest.raises(HTTPException) as error: period_bounds(period,year,month,NOW)
    assert error.value.status_code==422
