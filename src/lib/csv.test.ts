import { describe, test } from "node:test";
import { strict as assert } from "node:assert";

import { toCsv, isoDateForFilename } from "./csv";

describe("toCsv", () => {
  test("renders header + rows with trailing CRLF-joined lines + BOM", () => {
    const csv = toCsv(
      [
        { name: "Milk", price: 1200 },
        { name: "Tomato", price: 250 },
      ],
      [
        { header: "Name", value: (r) => r.name },
        { header: "Price", value: (r) => r.price },
      ]
    );
    // Strip leading BOM for easier assertion, but verify it's there.
    assert.equal(csv.charCodeAt(0), 0xfeff, "UTF-8 BOM present for Excel");
    const body = csv.slice(1);
    assert.equal(body, "Name,Price\r\nMilk,1200\r\nTomato,250");
  });

  test("quotes values containing commas, quotes, or newlines", () => {
    const csv = toCsv(
      [
        { name: 'Acme "Co", Inc.', note: "line 1\nline 2" },
      ],
      [
        { header: "Name", value: (r) => r.name },
        { header: "Note", value: (r) => r.note },
      ]
    );
    const body = csv.slice(1);
    assert.equal(body, 'Name,Note\r\n"Acme ""Co"", Inc.","line 1\nline 2"');
  });

  test("null / undefined become empty cells", () => {
    const csv = toCsv(
      [
        { a: "ok", b: null },
        { a: "ok", b: undefined },
        { a: "", b: "value" },
      ],
      [
        { header: "A", value: (r) => r.a },
        { header: "B", value: (r) => r.b },
      ]
    );
    const body = csv.slice(1);
    assert.equal(body, "A,B\r\nok,\r\nok,\r\n,value");
  });

  test("empty rows → just the header line", () => {
    const csv = toCsv([] as Array<{ x: string }>, [{ header: "X", value: (r) => r.x }]);
    assert.equal(csv.slice(1), "X");
  });

  test("numeric values stringified, booleans rendered as 'true'/'false'", () => {
    const csv = toCsv(
      [{ n: 42, b: true, dec: 3.14 }],
      [
        { header: "N", value: (r) => r.n },
        { header: "B", value: (r) => String(r.b) },
        { header: "Dec", value: (r) => r.dec },
      ]
    );
    const body = csv.slice(1);
    assert.equal(body, "N,B,Dec\r\n42,true,3.14");
  });

  test("header gets quoted if it contains a comma", () => {
    const csv = toCsv(
      [{ x: 1 }],
      [{ header: "X, kind of", value: (r) => r.x }]
    );
    const body = csv.slice(1);
    assert.equal(body, '"X, kind of"\r\n1');
  });
});

describe("isoDateForFilename", () => {
  test("formats as YYYY-MM-DD from local date components", () => {
    const d = new Date(2026, 3, 17); // April (zero-indexed month)
    assert.equal(isoDateForFilename(d), "2026-04-17");
  });

  test("pads single-digit month + day", () => {
    const d = new Date(2026, 0, 5); // January 5
    assert.equal(isoDateForFilename(d), "2026-01-05");
  });
});
