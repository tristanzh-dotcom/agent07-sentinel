type Shape = {
  kind: "text" | "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  value?: string;
};

export async function generateSlideWithPromptOnly(model: { complete: (prompt: string) => Promise<string> }) {
  const raw = await model.complete(
    "Guess exact x/y/width/height coordinates for a premium magazine style slide. Return JSON only."
  );
  return JSON.parse(raw) as Shape[];
}
