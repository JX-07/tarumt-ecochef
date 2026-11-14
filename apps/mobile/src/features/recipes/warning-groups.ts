export const recipeWarningGroups = (warnings: string[]) =>
  [
    {
      title: "Dietary Lifestyle",
      warnings: warnings.filter((warning) => warning.startsWith("Not confirmed suitable for ")),
    },
    {
      title: "Allergies & Intolerances",
      warnings: warnings.filter((warning) => warning.startsWith("Contains ")),
    },
    {
      title: "Food Dislikes",
      warnings: warnings.filter((warning) => warning.startsWith("Contains disliked ingredient: ")),
    },
  ].filter((group) => group.warnings.length > 0);
