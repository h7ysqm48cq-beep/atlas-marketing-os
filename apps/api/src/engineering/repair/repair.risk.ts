export function analyzeRepairRisk(
  filePath: string,
) {

  const highRiskPatterns = [
    "schema",
    "auth",
    "payment",
    "permission",
    "database",
  ];


  const highRisk =
    highRiskPatterns.some(
      keyword =>
        filePath
          .toLowerCase()
          .includes(keyword),
    );


  return highRisk
    ? {
        riskLevel:
          "high" as const,

        approvalRequired:
          true,
      }
    : {
        riskLevel:
          "low" as const,

        approvalRequired:
          false,
      };

}
