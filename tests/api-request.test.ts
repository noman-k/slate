import { describe, expect, it } from "vitest";
import { buildRequest, maskSecret, parseHeaders, urlProblem } from "../src/lib/api-request";
import { advance, evaluate, interpolate, parseProcedure, startRun, variablesOf } from "../src/lib/runner";

const node = (value: object) => `:::slate-node ${JSON.stringify(value)}`;
const step = (attrs: object, text = "") =>
  node({ type: "procedureStep", attrs, ...(text ? { content: [{ type: "text", text }] } : {}) });
const procedure = parseProcedure(
  [
    node({
      type: "procedureParams",
      attrs: {
        params: [
          { name: "order_number", type: "text", required: true },
          { name: "note", type: "text", required: false },
        ],
      },
    }),
    "## Look up",
    step(
      {
        step: "api",
        method: "POST",
        url: "https://api.example.com/orders/{{order_number}}/notes",
        headers: "Authorization: Bearer sk_live_1234567890\nX-Trace: {{order_number}}",
        body: '{ "note": "{{note}}" }',
        variable: "order",
        else: "Failed",
      },
      "Look up the order",
    ),
    step({ step: "if", variable: "order.status", op: "is", value: "shipped", then: "Shipped", else: "@end" }),
    "## Shipped",
    step({ step: "send" }, "Order {{order.id}} shipped by {{order.carrier.name}} ({{order_status}})"),
    "## Failed",
    step({ step: "end" }, "Couldn't reach the order API"),
  ].join("\n\n"),
);

describe("API steps", () => {
  it("builds the request with values encoded for where they go", () => {
    const run = startRun(procedure, { order_number: "A 1/2", note: 'Said "hi"\nthen left' });
    const request = buildRequest(procedure.steps[0], procedure, run.vars);
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://api.example.com/orders/A%201%2F2/notes");
    expect(JSON.parse(request.body!)).toEqual({ note: 'Said "hi"\nthen left' });
    expect(request.headers).toContainEqual(["X-Trace", "A 1/2"]);
    expect(request.headers).toContainEqual(["Content-Type", "application/json"]);
  });

  it("reads headers and masks secrets", () => {
    expect(parseHeaders("Accept: application/json\nnot a header\n: nope\nX-Key: a:b")).toEqual([
      ["Accept", "application/json"],
      ["X-Key", "a:b"],
    ]);
    expect(maskSecret("Bearer sk_live_1234567890")).toBe("Bearer ••••7890");
    expect(maskSecret("short")).toBe("••••");
  });

  it("refuses private, local and odd addresses on the server", () => {
    expect(urlProblem("https://api.example.com/x")).toBeNull();
    for (const url of [
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://10.0.0.4",
      "http://172.20.1.1",
      "http://192.168.1.1",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://2130706433/",
      "http://metadata.google.internal",
    ])
      expect(urlProblem(url)).toMatch(/Private and local/);
    expect(urlProblem("http://localhost:3000", { allowPrivate: true })).toBeNull();
    expect(urlProblem("ftp://example.com")).toMatch(/http and https/);
    expect(urlProblem("https://user:pass@example.com")).toMatch(/header/);
    expect(urlProblem("example.com")).toMatch(/full URL/);
  });

  it("saves the response for later steps and branches on its fields", () => {
    expect(variablesOf(procedure)).toEqual(expect.arrayContaining(["order", "order_status"]));
    let run = startRun(procedure, { order_number: "A-1" });
    run = advance(procedure, run, {
      kind: "response",
      response: {
        status: 200,
        ok: true,
        body: JSON.stringify({ id: "A-1", status: "shipped", carrier: { name: "UPS" } }),
      },
    });
    expect(run.vars.order_status).toBe("200");
    expect(run.log[0].result).toBe("200 OK");
    expect(evaluate(procedure.steps[1], procedure, run.vars).holds).toBe(true);
    run = advance(procedure, run, { kind: "next" });
    expect(interpolate(procedure.steps[run.step].text, procedure, run.vars)).toBe("Order A-1 shipped by UPS (200)");
  });

  it("goes to the failure path when the request fails", () => {
    let run = startRun(procedure, { order_number: "A-1" });
    run = advance(procedure, run, { kind: "response", response: { status: 503, ok: false, body: "down" } });
    expect(procedure.sections[procedure.steps[run.step].section]).toBe("Failed");
    expect(run.log[0].result).toBe("Failed: 503");
    run = startRun(procedure, { order_number: "A-1" });
    run = advance(procedure, run, { kind: "response", response: { status: 0, ok: false, body: "", error: "CORS" } });
    expect(run.log[0].result).toBe("Failed: CORS");
  });
});
