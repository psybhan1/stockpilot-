export function buildWebsiteOrderPlaywrightTemplate(input: {
  supplierName: string;
  website?: string | null;
  orderNumber: string;
  lines: Array<{ description: string; quantity: number; unit: string }>;
}) {
  const destination = input.website ?? "https://supplier-portal.example.com";
  const lineSummary = input.lines
    .map(
      (line) =>
        `  { description: ${JSON.stringify(line.description)}, quantity: ${line.quantity}, unit: ${JSON.stringify(line.unit)} }`
    )
    .join(",\n");

  return `import { chromium } from "@playwright/test";

const order = {
  supplierName: ${JSON.stringify(input.supplierName)},
  orderNumber: ${JSON.stringify(input.orderNumber)},
  website: ${JSON.stringify(destination)},
  lines: [
${lineSummary}
  ],
};

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(order.website);
  await page.waitForLoadState("networkidle");

  // TODO: Replace with the supplier's real login fields and secrets source.
  // await page.getByLabel("Email").fill(process.env.SUPPLIER_USERNAME ?? "");
  // await page.getByLabel("Password").fill(process.env.SUPPLIER_PASSWORD ?? "");
  // await page.getByRole("button", { name: /sign in/i }).click();

  // TODO: Replace the selectors below with the supplier's cart fields.
  for (const line of order.lines) {
    console.log("Queue line for review:", line);
    // await page.getByPlaceholder("Search products").fill(line.description);
    // await page.getByRole("button", { name: /add to cart/i }).click();
    // await page.getByLabel(/quantity/i).fill(String(line.quantity));
  }

  await page.screenshot({
    path: \`stockpilot-\${order.orderNumber}-review.png\`,
    fullPage: true,
  });

  console.log("Cart prepared for review. Stop before any final submit button.");
  // Never auto-submit in v1.
  // await page.getByRole("button", { name: /place order|submit order|checkout/i }).click();
}

void main();
`;
}
