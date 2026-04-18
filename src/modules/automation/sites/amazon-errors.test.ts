import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectAmazonErrorFromState } from "./amazon-errors";

const OK = { url: "https://www.amazon.com/dp/B000FDL68W", title: "Urnex Cafiza", bodyText: "Normal product page content." };

describe("detectAmazonErrorFromState — URL signatures", () => {
  it("detects /errors path", () => {
    assert.equal(
      detectAmazonErrorFromState({ url: "https://www.amazon.com/errors/validateCaptcha", title: "", bodyText: "" }),
      true
    );
  });

  it("detects /404 path", () => {
    assert.equal(
      detectAmazonErrorFromState({ url: "https://www.amazon.ca/404/", title: "", bodyText: "" }),
      true
    );
  });

  it("detects /gp/aw/errors path", () => {
    assert.equal(
      detectAmazonErrorFromState({ url: "https://www.amazon.com/gp/aw/errors", title: "", bodyText: "" }),
      true
    );
  });

  it("detects /gp/error path", () => {
    assert.equal(
      detectAmazonErrorFromState({ url: "https://www.amazon.com/gp/error?whatever", title: "", bodyText: "" }),
      true
    );
  });

  it("detects node-lookup error url", () => {
    assert.equal(
      detectAmazonErrorFromState({
        url: "https://www.amazon.com/b?node=12345&ref=lookup_error",
        title: "",
        bodyText: "",
      }),
      true
    );
  });

  it("ignores bare /b?node without lookup", () => {
    assert.equal(
      detectAmazonErrorFromState({
        url: "https://www.amazon.com/b?node=12345&ref=nav",
        title: "",
        bodyText: "",
      }),
      false
    );
  });

  it("URL matching is case-insensitive", () => {
    assert.equal(
      detectAmazonErrorFromState({ url: "https://www.amazon.com/Errors/x", title: "", bodyText: "" }),
      true
    );
  });
});

describe("detectAmazonErrorFromState — title signatures (English)", () => {
  it("detects 'Page not found' title", () => {
    assert.equal(
      detectAmazonErrorFromState({ url: "", title: "Amazon.com: Page not found", bodyText: "" }),
      true
    );
  });

  it("detects 'couldn't find that page' title", () => {
    assert.equal(
      detectAmazonErrorFromState({ url: "", title: "We couldn't find that page", bodyText: "" }),
      true
    );
  });

  it("detects 'couldnt find that page' title (no apostrophe)", () => {
    assert.equal(
      detectAmazonErrorFromState({ url: "", title: "We couldnt find that page", bodyText: "" }),
      true
    );
  });

  it("detects 'sorry something' title", () => {
    assert.equal(
      detectAmazonErrorFromState({ url: "", title: "Sorry! Something went wrong", bodyText: "" }),
      true
    );
  });

  it("title matching is case-insensitive", () => {
    assert.equal(
      detectAmazonErrorFromState({ url: "", title: "PAGE NOT FOUND", bodyText: "" }),
      true
    );
  });
});

describe("detectAmazonErrorFromState — title signatures (French)", () => {
  it("detects 'désolés' title (amazon.ca French fallback)", () => {
    assert.equal(
      detectAmazonErrorFromState({ url: "", title: "Désolés, page introuvable", bodyText: "" }),
      true
    );
  });

  it("detects 'Nous sommes désolés' title", () => {
    assert.equal(
      detectAmazonErrorFromState({ url: "", title: "Nous sommes désolés", bodyText: "" }),
      true
    );
  });
});

describe("detectAmazonErrorFromState — body signatures (English)", () => {
  it("detects 'we couldn't find that page'", () => {
    assert.equal(
      detectAmazonErrorFromState({
        url: "",
        title: "",
        bodyText: "Oops! we couldn't find that page.",
      }),
      true
    );
  });

  it("detects 'we were unable to find that page'", () => {
    assert.equal(
      detectAmazonErrorFromState({
        url: "",
        title: "",
        bodyText: "We were unable to find that page. Try searching.",
      }),
      true
    );
  });

  it("detects 'page you were looking for'", () => {
    assert.equal(
      detectAmazonErrorFromState({
        url: "",
        title: "",
        bodyText: "The page you were looking for has been moved.",
      }),
      true
    );
  });

  it("detects 'page you are looking for'", () => {
    assert.equal(
      detectAmazonErrorFromState({
        url: "",
        title: "",
        bodyText: "The page you are looking for is no longer available.",
      }),
      true
    );
  });

  it("detects the classic 'dogs of amazon'", () => {
    assert.equal(
      detectAmazonErrorFromState({
        url: "",
        title: "",
        bodyText: "Meet the Dogs of Amazon on their special home page.",
      }),
      true
    );
  });
});

describe("detectAmazonErrorFromState — body signatures (French)", () => {
  it("detects 'nous sommes désolés...erreur...s'est produite'", () => {
    assert.equal(
      detectAmazonErrorFromState({
        url: "",
        title: "",
        bodyText: "Nous sommes désolés. Une erreur s'est produite lors du traitement.",
      }),
      true
    );
  });

  it("detects 'page d'accueil d'amazon' fallback link copy", () => {
    assert.equal(
      detectAmazonErrorFromState({
        url: "",
        title: "",
        bodyText: "Retour à la page d'accueil d'Amazon.",
      }),
      true
    );
  });
});

describe("detectAmazonErrorFromState — body scanning limits", () => {
  it("only scans the first 2000 chars of body", () => {
    const junk = "x".repeat(2100);
    const bodyText = junk + " dogs of amazon";
    assert.equal(
      detectAmazonErrorFromState({ url: "", title: "", bodyText }),
      false,
      "marker past 2000 chars must NOT match"
    );
  });

  it("body just under 2000 chars is still scanned", () => {
    const junk = "x".repeat(1980);
    const bodyText = junk + " dogs of amazon";
    assert.equal(
      detectAmazonErrorFromState({ url: "", title: "", bodyText }),
      true
    );
  });
});

describe("detectAmazonErrorFromState — clean pages", () => {
  it("returns false on a normal product page", () => {
    assert.equal(detectAmazonErrorFromState(OK), false);
  });

  it("returns false when all fields are empty", () => {
    assert.equal(
      detectAmazonErrorFromState({ url: "", title: "", bodyText: "" }),
      false
    );
  });

  it("returns false for product URLs containing unrelated numbers", () => {
    assert.equal(
      detectAmazonErrorFromState({
        url: "https://www.amazon.com/dp/B0404FOO/",
        title: "Something",
        bodyText: "",
      }),
      false
    );
  });

  it("does NOT fire on the word 'sorry' alone", () => {
    // Only "sorry something" matches; bare "sorry" should not.
    assert.equal(
      detectAmazonErrorFromState({ url: "", title: "Sorry for the delay", bodyText: "" }),
      false
    );
  });

  it("does NOT fire on the word 'erreur' alone", () => {
    assert.equal(
      detectAmazonErrorFromState({
        url: "",
        title: "",
        bodyText: "Erreur de saisie — veuillez réessayer.",
      }),
      false
    );
  });
});
