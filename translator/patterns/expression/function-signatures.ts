export type FunctionCallSignature = {
  positional: string[];
};

export function parseFunctionCallSignature(signatureText: string | undefined): FunctionCallSignature | null {
  if (signatureText === undefined) {
    return null;
  }
  try {
    const parsed = JSON.parse(signatureText) as Partial<FunctionCallSignature>;
    if (!Array.isArray(parsed.positional) || !parsed.positional.every((name) => typeof name === 'string')) {
      return null;
    }
    return {
      positional: parsed.positional,
    };
  } catch {
    return null;
  }
}
