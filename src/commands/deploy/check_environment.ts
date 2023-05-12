import { cmd } from "../../lib/cmd";

export const check_environment = async () => {
  try {
    await cmd("docker ps");
  } catch (error) {
    console.log(error);
    throw new Error(`Docker is not running`);
  }
};
