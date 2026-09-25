import base64

import pytest

from app.services.kyc_document_ai import (
    decide_kyc_auto_verification,
    image_data_url_for_model,
    manual_review_decision,
    verhoeff_valid,
)


def _model(**overrides):
    payload = {
        "documentType": "AADHAAR",
        "extractedIdNumber": "234123412346",
        "nameOnDocument": "Rahul Sharma",
        "dateOfBirth": "12/05/2004",
        "readable": True,
        "looksAuthentic": True,
        "confidence": 0.93,
        "reason": "Aadhaar layout",
    }
    payload.update(overrides)
    return payload


def test_verhoeff_accepts_a_valid_aadhaar_number():
    assert verhoeff_valid("234123412346")


def test_clear_matching_aadhaar_is_verified_automatically():
    decision = decide_kyc_auto_verification(
        model=_model(),
        candidate_name="Rahul Sharma",
    )
    assert decision.auto_verified is True
    assert decision.document_type == "AADHAAR"
    assert decision.date_of_birth == "2004-05-12"
    assert decision.date_of_birth_precision == "full"
    assert decision.message == "Your Aadhaar card was verified automatically."
    assert decision.as_profile()["outcome"] == "VERIFIED"
    assert decision.as_profile()["dateOfBirth"] == "2004-05-12"


def test_unknown_document_goes_to_manual_review():
    decision = decide_kyc_auto_verification(
        model=_model(documentType="UNKNOWN", readable=False, looksAuthentic=False, confidence=0.2),
        candidate_name="Rahul Sharma",
    )
    assert decision.auto_verified is False
    assert decision.as_profile()["outcome"] == "MANUAL_REVIEW"
    assert "administrator will review it" in decision.message


def test_unreadable_number_is_not_auto_verified():
    decision = decide_kyc_auto_verification(
        model=_model(extractedIdNumber=""),
        candidate_name="Rahul Sharma",
    )
    assert decision.auto_verified is False
    assert any("number" in reason.lower() for reason in decision.reasons)


def test_year_of_birth_is_enough_when_the_full_date_is_not_printed():
    decision = decide_kyc_auto_verification(
        model=_model(dateOfBirth="2004"),
        candidate_name="Rahul Sharma",
    )
    assert decision.auto_verified is True
    assert decision.date_of_birth == "2004"
    assert decision.date_of_birth_precision == "year"


def test_year_of_birth_label_is_not_stored_as_1_january():
    decision = decide_kyc_auto_verification(
        model=_model(dateOfBirth="01/01/2004", dateOfBirthText="Year of Birth: 2004"),
        candidate_name="Rahul Sharma",
    )
    assert decision.date_of_birth == "2004"
    assert decision.date_of_birth_precision == "year"
    assert decision.as_profile()["dateOfBirth"] == "2004"


def test_placeholder_1_january_without_printed_text_is_kept_as_the_year():
    decision = decide_kyc_auto_verification(
        model=_model(dateOfBirth="01/01/2004"),
        candidate_name="Rahul Sharma",
    )
    assert decision.date_of_birth == "2004"
    assert decision.date_of_birth_precision == "year"


def test_printed_1_january_is_kept_as_a_full_date():
    decision = decide_kyc_auto_verification(
        model=_model(dateOfBirth="01/01/2004", dateOfBirthText="DOB: 01/01/2004"),
        candidate_name="Rahul Sharma",
    )
    assert decision.date_of_birth == "2004-01-01"
    assert decision.date_of_birth_precision == "full"


def test_missing_date_of_birth_is_not_auto_verified():
    decision = decide_kyc_auto_verification(
        model=_model(dateOfBirth=""),
        candidate_name="Rahul Sharma",
    )
    assert decision.auto_verified is False
    assert any("date of birth" in reason.lower() for reason in decision.reasons)


def test_different_name_is_not_auto_verified():
    decision = decide_kyc_auto_verification(
        model=_model(nameOnDocument="Priya Nair"),
        candidate_name="Rahul Sharma",
    )
    assert decision.auto_verified is False
    assert any("name" in reason.lower() for reason in decision.reasons)


def test_pan_card_can_be_verified_when_details_match():
    decision = decide_kyc_auto_verification(
        model=_model(
            documentType="PAN",
            extractedIdNumber="ABCDE1234F",
            nameOnDocument="Rahul Sharma",
            dateOfBirth="12/05/2004",
        ),
        candidate_name="Rahul Kumar Sharma",
    )
    assert decision.auto_verified is True
    assert decision.document_type == "PAN"


def test_low_confidence_stays_with_the_administrator():
    decision = decide_kyc_auto_verification(
        model=_model(confidence=0.4),
        candidate_name="Rahul Sharma",
    )
    assert decision.auto_verified is False


def test_unavailable_ai_asks_for_administrator_review():
    decision = manual_review_decision("Automatic verification could not be completed")
    assert decision.auto_verified is False
    assert decision.document_type == "UNKNOWN"
    assert "administrator will review it" in decision.message


def test_driving_licence_name_drops_the_guardian_line():
    from app.services.kyc_document_ai import driving_licence_holder_name, split_holder_name

    assert driving_licence_holder_name("RAHUL SHARMA S/O RAMESH KUMAR") == "RAHUL SHARMA"
    assert driving_licence_holder_name("Name: Priya Nair\nD/O SUNITA NAIR") == "Priya Nair"
    assert driving_licence_holder_name("S/O RAMESH KUMAR") == ""
    assert split_holder_name("RAHUL KUMAR SHARMA") == ("Rahul", "Kumar Sharma")


def test_driving_licence_uses_the_holder_name():
    decision = decide_kyc_auto_verification(
        model=_model(
            documentType="DRIVING_LICENSE",
            extractedIdNumber="MH0120110012345",
            nameOnDocument="RAHUL SHARMA S/O RAMESH KUMAR",
            dateOfBirth="12/05/2004",
        ),
        candidate_name="Rahul Sharma",
    )
    assert decision.name_on_document == "RAHUL SHARMA"
    assert decision.auto_verified is True


def test_pdf_upload_is_converted_to_a_png_for_the_model():
    pymupdf = pytest.importorskip("pymupdf")
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Sample identity document")
    pdf_bytes = document.tobytes()
    document.close()
    data_url = "data:application/pdf;base64," + base64.b64encode(pdf_bytes).decode("ascii")

    image_url = image_data_url_for_model(data_url, "aadhaar.pdf")

    assert image_url.startswith("data:image/png;base64,")
    raw = base64.b64decode(image_url.split(",", 1)[1])
    assert raw.startswith(b"\x89PNG")
