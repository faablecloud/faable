import { Builder } from "./Builder";

export const import_builder = async (
  runtime_name: string
): Promise<Builder> => {
  try {
    let builder_module = await import(`../../builder/${runtime_name}`);
    return builder_module.default;
  } catch (e) {
    throw new Error(`Cannot import builder for ${runtime_name}`);
  }
};
