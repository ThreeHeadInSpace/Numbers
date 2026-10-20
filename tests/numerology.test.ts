import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateLifePath,
  reduceNumber,
  validateBirthDate,
  periodParameters,
} from "../shared/numerology.js";

test("life path: day, month and year are reduced separately", () => {
  assert.equal(calculateLifePath("1990-01-01").number, 3);
  assert.equal(calculateLifePath("1992-03-07").number, 4);
  assert.deepEqual(calculateLifePath("1981-09-29").parts, [11, 9, 1]);
  assert.equal(calculateLifePath("1981-09-29").number, 3);
});
test("all master numbers are explicitly retained", () => {
  assert.equal(calculateLifePath("2000-01-08").number, 11);
  assert.equal(calculateLifePath("1980-11-02").number, 22);
  assert.equal(calculateLifePath("2009-11-11").number, 33);
  assert.equal(calculateLifePath("2009-11-11").isMaster, true);
  assert.equal(reduceNumber(29), 11);
  assert.equal(reduceNumber(44), 8);
});
test("calendar validation rejects overflow, future dates and invalid leap years", () => {
  for (const invalid of [
    "1900-02-29",
    "2023-02-29",
    "2020-04-31",
    "2020-13-01",
    "2020-00-12",
    "1899-12-31",
    "2020-1-1",
    "",
    "no date",
    "2099-01-01",
  ]) {
    assert.throws(() => validateBirthDate(invalid));
  }
  assert.equal(validateBirthDate("2000-02-29"), "2000-02-29");
  assert.equal(validateBirthDate("1900-01-01"), "1900-01-01");
});
test("seven day period crosses month and year boundaries; contains no birthday", () => {
  const params = periodParameters("1990-01-01", "2026-12-29");
  assert.equal(params.days.length, 7);
  assert.equal(params.end, "2027-01-04");
  assert.equal(params.days[3].date, "2027-01-01");
  assert.equal(JSON.stringify(params).includes("1990"), false);
  assert.ok(
    params.days.every((day) => day.personalDay >= 1 && day.personalDay <= 33),
  );
});
