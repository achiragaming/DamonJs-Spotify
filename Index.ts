import { DamonJsPlugin } from './src/Plugin';
import packageJson from './package.json';
const packageData = {
  name: packageJson.name,
  version: packageJson.version,
  author: packageJson.author,
};

export { DamonJsPlugin, packageData };
