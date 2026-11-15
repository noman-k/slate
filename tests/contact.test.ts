import { describe, expect, it } from "vitest";
import { MESSAGE_MAX, isTopic, validateContact } from "../src/lib/contact";

describe("contact form rules", () => {
  it("accepts a complete message", () => {
    expect(validateContact({ topic: "privacy", email: "a@example.com", message: "Where is my data stored?" })).toEqual(
      {},
    );
  });
  it("explains each problem in plain words", () => {
    const errors = validateContact({ topic: "", email: "", message: "" });
    expect(errors).toEqual({
      topic: "Choose what your message is about.",
      email: "Add your email, so you can get a reply.",
      message: "Write a message.",
    });
    expect(validateContact({ topic: "other", email: "not-an-email", message: "Hello there, friend" }).email).toMatch(
      /doesn't look right/,
    );
    expect(validateContact({ topic: "other", email: "a@example.com", message: "short" }).message).toMatch(
      /at least 10/,
    );
    expect(
      validateContact({ topic: "other", email: "a@example.com", message: "x".repeat(MESSAGE_MAX + 1) }).message,
    ).toMatch(/shorten/);
  });
  it("knows its topics", () => {
    expect(isTopic("delete")).toBe(true);
    expect(isTopic("admin")).toBe(false);
  });
});
