import * as path from 'path';

import b from '@babel/core';
import { Visitor } from '@babel/traverse';
import * as t from '@babel/types';

import {
  escapeDotForRegExp,
  getConstEnumMemberExpression,
  getNamespaceAliasMapFromProgram,
} from './utils';

const EMPTY = {
  alias: new Map<string, string>(),
  enums: {} as Record<string, string | number | boolean>,
};

const internalVisitor: Visitor<{
  enums: Record<string, string | number | boolean>;
  namespaceAlias: Map<string, string>;
}> = {
  TSImportEqualsDeclaration(path) {
    path.remove();
  },
  MemberExpression(path, state) {
    const { enums = EMPTY.enums, namespaceAlias = EMPTY.alias } = state;
    const key = getConstEnumMemberExpression(path.node);
    if (!key) {
      return;
    }
    const firstIdentifier = key.split('.')[0];
    const binding = path.scope.getBindingIdentifier(firstIdentifier);
    if (binding) {
      path.skip();
      return;
    }
    let v = enums[key];
    if (typeof v === 'undefined') {
      for (const [left, right] of namespaceAlias) {
        if (!key.startsWith(left)) {
          continue;
        }
        const newKey = key.replace(
          new RegExp('^' + escapeDotForRegExp(left)),
          right
        );
        if (enums[newKey] !== undefined) {
          v = enums[newKey];
          break;
        }
      }
    }
    if (typeof v === 'undefined') {
      return;
    }
    let replaced: t.Node | undefined;
    if (typeof v === 'number') {
      replaced = t.numericLiteral(v);
    } else if (typeof v === 'boolean') {
      replaced = t.booleanLiteral(v);
    } else if (typeof v === 'string') {
      replaced = t.stringLiteral(v);
    }

    if (!replaced) {
      return;
    }
    const lastDot = key.lastIndexOf('.');
    const label = key.substr(lastDot + 1);
    if (replaced) {
      path.replaceWith(replaced);
      path.addComment('trailing', label, false);
    }
  },
};

export default function babelPluginTypescriptConstEnum(
  _: typeof b,
  options: {
    enums?: Record<string, string | number | boolean>;
    enumFile?: string;
  } = {}
) {
  let { enums = {}, enumFile } = options;
  enums = enums || {};
  if (enumFile) {
    enums = { ...require(path.resolve(process.cwd(), enumFile)), ...enums };
  }
  const allKeys = Object.keys(enums!);
  if (!allKeys) {
    return { visitor: {} };
  }
  return {
    visitor: {
      Program(path) {
        const namespaceAlias = getNamespaceAliasMapFromProgram(
          path.node.body,
          allKeys,
          path
        );

        path.traverse(internalVisitor, {
          enums,
          namespaceAlias,
        });
      },
    } as Visitor<{}>,
  };
}
