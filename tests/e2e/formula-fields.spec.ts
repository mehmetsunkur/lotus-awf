import { test, expect } from "./support/fixtures";
import type { APIRequestContext } from "@playwright/test";

// End-to-end wiring for ADR-0014 read-side formula fields: a form in one app
// (desk) has a formula field that reads another app (library) via @DbColumn,
// resolved server-side and rendered read-only. (ACL divergence per principal is
// covered exhaustively in tests/unit/formula.spec.ts.)

async function createApp(request: APIRequestContext, appId: string, docType: string) {
  const res = await request.post("/api/platform/apps", {
    data: { appId, title: appId, docType, docTypeTitle: docType }
  });
  expect(res.ok(), `create app ${appId}: ${res.status()}`).toBeTruthy();
}

async function putForm(request: APIRequestContext, appId: string, docType: string, fields: unknown[]) {
  const res = await request.put(`/api/apps/${appId}/definitions/form:${docType}`, {
    data: { kind: "form", appId, docType, title: docType, fields }
  });
  expect(res.ok(), `put form:${docType}: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function createDoc(request: APIRequestContext, appId: string, docType: string, payload: unknown): Promise<string> {
  const res = await request.post(`/api/apps/${appId}/documents`, { data: { docType, payload } });
  expect(res.ok(), `create ${docType}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json())._id as string;
}

test.describe("ADR-0014 formula fields", () => {
  test("a formula field resolves a cross-app @DbColumn read, server-side and read-only", async ({ page }) => {
    const api = page.request;

    // App A: library of books.
    await createApp(api, "library", "book");
    await putForm(api, "library", "book", [{ name: "title", type: "text", label: "Title", required: true }]);
    await createDoc(api, "library", "book", { title: "Alpha" });
    await createDoc(api, "library", "book", { title: "Beta" });

    // App B: desk notes, with a formula field counting readable library books and
    // a second formula pointing at a non-existent app (must fail closed).
    await createApp(api, "desk", "note");
    await putForm(api, "desk", "note", [
      { name: "title", type: "text", label: "Title", required: true },
      { name: "bookCount", type: "number", mode: "computed-for-display", label: "Books", formula: "(await DbColumn('library', 'book', 'payload.title')).length" },
      { name: "ghost", type: "text", mode: "computed-for-display", label: "Ghost", formula: "await DbLookup('nope', 'x', 'a', 'b', 'c')" }
    ]);
    const noteId = await createDoc(api, "desk", "note", { title: "Sprint notes" });

    // Server resolves formula fields, ACL-scoped, from the local replica.
    const formulas = await (await api.get(`/api/apps/desk/documents/${encodeURIComponent(noteId)}/formulas`)).json();
    expect(formulas.bookCount).toBe(2);
    expect(formulas.ghost ?? null).toBeNull(); // fail-closed: unknown app → undefined (omitted)

    // The formula field is NOT stored on the document payload.
    const note = await (await api.get(`/api/apps/desk/documents/${encodeURIComponent(noteId)}`)).json();
    expect(note.payload).toEqual({ title: "Sprint notes" });

    // UI renders the resolved value read-only (an <output>, not an editable input).
    await page.goto(`/desk.nsf/documents/${encodeURIComponent(noteId)}`);
    await expect(page.getByTestId("document-form")).toBeVisible();
    await expect(page.getByTestId("field-bookCount")).toHaveText("2");
    expect(await page.getByTestId("field-bookCount").evaluate((el) => el.tagName)).toBe("OUTPUT");
  });

  test("a cross-app lookup is gated on the caller's ACL in the TARGET app (ADR-0026)", async ({ page, bobApi }) => {
    const api = page.request;

    // library: no ACL entry for bob. desk: bob is a reader.
    await createApp(api, "library", "book");
    await putForm(api, "library", "book", [{ name: "title", type: "text", label: "Title", required: true }]);
    await createDoc(api, "library", "book", { title: "Alpha" });
    await createDoc(api, "library", "book", { title: "Beta" });

    await createApp(api, "desk", "note");
    await putForm(api, "desk", "note", [
      { name: "title", type: "text", label: "Title", required: true },
      { name: "bookCount", type: "number", mode: "computed-for-display", label: "Books", formula: "(await DbColumn('library', 'book', 'payload.title')).length" },
      { name: "firstBook", type: "text", mode: "computed-for-display", label: "First", formula: "await DbLookup('library', 'book', 'payload.title', 'Alpha', 'payload.title')" }
    ]);
    const noteId = await createDoc(api, "desk", "note", { title: "Sprint notes" });
    const grant = async (appId: string, entries: Array<{ principal: string; level: string }>) => {
      const res = await api.put(`/api/apps/${appId}/access`, {
        data: { entries: [{ principal: "group:admins", level: "manager" }, ...entries] }
      });
      expect(res.ok(), `grant ${appId}: ${res.status()} ${await res.text()}`).toBeTruthy();
    };
    await grant("desk", [{ principal: "person:bob", level: "reader" }]);

    const bobFormulas = async () =>
      (await bobApi.get(`/api/apps/desk/documents/${encodeURIComponent(noteId)}/formulas`)).json();

    // Bob can read the note, but the lookup into an app he cannot access returns nothing.
    expect(await bobFormulas()).toMatchObject({ bookCount: 0 });
    expect((await bobFormulas()).firstBook ?? null).toBeNull();
    expect((await bobApi.get("/api/apps/library/documents?docType=book")).status()).toBe(403);

    // Granting bob Reader on the target app opens every row to his lookups.
    await grant("library", [{ principal: "person:bob", level: "reader" }]);
    expect(await bobFormulas()).toMatchObject({ bookCount: 2, firstBook: "Alpha" });
  });
});
