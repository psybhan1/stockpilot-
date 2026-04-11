export function calculateRestockToParOrder(input: {
  parLevelBase: number;
  reportedOnHandBase: number;
  packSizeBase: number;
  minimumOrderQuantity: number;
}) {
  const shortageBase = Math.max(input.parLevelBase - input.reportedOnHandBase, 0);

  if (shortageBase === 0) {
    return {
      shortageBase: 0,
      recommendedPackCount: 0,
      orderQuantityBase: 0,
    };
  }

  const normalizedPackSize = Math.max(input.packSizeBase, 1);
  const normalizedMinimumOrderQuantity = Math.max(input.minimumOrderQuantity, 1);
  const recommendedPackCount = Math.max(
    Math.ceil(shortageBase / normalizedPackSize),
    normalizedMinimumOrderQuantity
  );

  return {
    shortageBase,
    recommendedPackCount,
    orderQuantityBase: recommendedPackCount * normalizedPackSize,
  };
}
