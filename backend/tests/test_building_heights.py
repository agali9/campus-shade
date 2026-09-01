from src.building_data_loader import _parse_building_height


def test_parse_height_prefers_hgt_agl():
    assert _parse_building_height({"HGT_AGL": 22.5, "height": 3}) == 22.5


def test_parse_height_falls_back_avght():
    assert _parse_building_height({"AVGHT_M": 11.0}) == 11.0


def test_parse_height_osm_levels():
    assert _parse_building_height({"building:levels": 4}) == 12.0


def test_parse_height_default():
    assert _parse_building_height({}) == 9.0
