export function parseRepairOutput(
  output: string,
): string {

  let result =
    output.trim();


  if (
    result.startsWith(
      "```",
    )
  ) {

    result =
      result
        .replace(
          /^```[a-zA-Z]*\n?/,
          "",
        )
        .replace(
          /```$/,
          "",
        )
        .trim();

  }


  const marker =
    result.indexOf(
      "Here is the fixed code:",
    );


  if (
    marker !== -1
  ) {

    result =
      result
        .slice(
          marker +
          "Here is the fixed code:"
            .length,
        )
        .trim();

  }


  return result;

}
