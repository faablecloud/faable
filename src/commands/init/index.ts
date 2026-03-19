import { CommandModule } from "yargs";
import { writeGithubAction } from "./writeGithubAction";

export const init: CommandModule<any, { overwrite: boolean }> = {
  command: ["initialize", "$0"],
  describe: "Initialize Faable",
  builder: (yargs) => {
    return yargs
      .option("overwrite", {
        alias: "o",
        type: "boolean",
        description: "Overwrite generated file",
        default: false,
      })
      .showHelpOnFail(false) as any;
  },

  handler: async (args) => {
    const { overwrite } = args;
  
    await writeGithubAction({overwrite});
  },
};
