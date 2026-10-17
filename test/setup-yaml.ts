import { parseYaml, stringifyYaml } from 'obsidian';
import { setYamlAdapter } from '../src/yamlAdapter';

setYamlAdapter({ parse: parseYaml, stringify: stringifyYaml });
