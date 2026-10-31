import { ApiError } from "./errors.ts";
import type { ResponseValidator } from "./types.ts";

export async function validateResponse<T>(
	validator: ResponseValidator<T>,
	input: unknown,
): Promise<T> {
	// ArkType schemas are callable, but invalid input returns ArkErrors. Prefer
	// their throwing assertion API before the generic function/parser contracts.
	if ("assert" in validator && typeof validator.assert === "function") {
		return validator.assert(input);
	}
	if (typeof validator === "function") return validator(input);
	if ("parse" in validator) {
		return validator.parseAsync
			? validator.parseAsync(input)
			: validator.parse(input);
	}
	throw new TypeError("Unsupported response validator");
}

/** Transport errors remain untouched; validation failures have their own stable code. */
export async function createValidatedEndpoint<T>(
	schema: ResponseValidator<T>,
	fetcher: () => Promise<unknown>,
): Promise<T> {
	const data = await fetcher();
	try {
		return await validateResponse(schema, data);
	} catch (cause) {
		throw new ApiError(0, "Response validation failed", data, "", {
			code: "VALIDATION_ERROR",
			cause,
		});
	}
}
