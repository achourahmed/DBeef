import pytest

from dbeef.adapters.base import NotFound
from dbeef.linkcheck import check_link, list_links


def test_list_links(project):
    links = list_links(project)
    assert [l.index for l in links] == [0, 1, 2]
    assert links[0].from_.collection == "runs" and links[0].to.store == "roster"


def test_check_link_counts_missing_values(project):
    c = check_link(project, 0, sample=50)
    # r1's inchikey is in the roster, r2's is not
    assert (c.sampled, c.missing) == (2, 1)
    assert c.examples == ["XEFQLINVKFYRCS-UHFFFAOYSA-N"]
    with pytest.raises(NotFound):
        check_link(project, 9)
