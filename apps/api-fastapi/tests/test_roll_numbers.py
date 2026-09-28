from app.services.roll_numbers import plan_roll_numbers


def _student(enrollment_id: str, first: str, last: str, roll: str = "", locked: bool = False) -> dict:
    return {
        "id": enrollment_id,
        "first_name": first,
        "last_name": last,
        "roll_number": roll,
        "roll_locked": locked,
    }


def test_students_are_numbered_from_1_in_alphabetical_order():
    planned = plan_roll_numbers(
        [
            _student("c", "Zara", "Khan"),
            _student("a", "Asha", "Iyer"),
            _student("b", "Meera", "Das"),
        ]
    )
    assert planned == {"a": "1", "b": "2", "c": "3"}


def test_name_order_ignores_capitalisation():
    planned = plan_roll_numbers(
        [
            _student("b", "somya", "test"),
            _student("a", "Ella", "Bright"),
        ]
    )
    assert planned == {"a": "1", "b": "2"}


def test_locked_roll_is_kept_and_the_rest_continue_from_1():
    planned = plan_roll_numbers(
        [
            _student("locked", "Test", "User", roll="5", locked=True),
            _student("a", "Asha", "Iyer"),
            _student("b", "Meera", "Das"),
        ]
    )
    assert planned["locked"] == "5"
    assert planned["a"] == "1"
    assert planned["b"] == "2"


def test_locked_roll_1_is_skipped_for_the_alphabetical_sequence():
    planned = plan_roll_numbers(
        [
            _student("locked", "Test", "One", roll="1", locked=True),
            _student("a", "Asha", "Iyer"),
            _student("b", "Meera", "Das"),
        ]
    )
    assert planned["locked"] == "1"
    assert planned["a"] == "2"
    assert planned["b"] == "3"
