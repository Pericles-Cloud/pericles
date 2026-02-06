/**
 * Safe Expression Evaluator
 *
 * Evaluates condition expressions WITHOUT using eval().
 * Supports basic comparison and logical operators.
 *
 * Supported operators: ==, !=, >, <, >=, <=, &&, ||, !
 * Variable access: variables.fieldName or variables['fieldName']
 *
 * Examples:
 *   - "variables.severity > 0.7"
 *   - "variables.category == 'weather'"
 *   - "variables.severity > 0.7 && variables.category == 'weather'"
 *   - "!variables.isResolved"
 */

type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'BOOLEAN'
  | 'NULL'
  | 'IDENTIFIER'
  | 'OPERATOR'
  | 'LPAREN'
  | 'RPAREN'
  | 'DOT'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string | number | boolean | null;
  raw: string;
}

/**
 * Tokenizer - converts expression string into tokens
 */
function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i];

    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Numbers (including decimals)
    if (/\d/.test(char) || (char === '-' && /\d/.test(expression[i + 1]))) {
      let numStr = '';
      if (char === '-') {
        numStr = '-';
        i++;
      }
      while (i < expression.length && (/\d/.test(expression[i]) || expression[i] === '.')) {
        numStr += expression[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr), raw: numStr });
      continue;
    }

    // Strings (single or double quoted)
    if (char === '"' || char === "'") {
      const quote = char;
      let str = '';
      i++; // Skip opening quote
      while (i < expression.length && expression[i] !== quote) {
        if (expression[i] === '\\' && i + 1 < expression.length) {
          i++;
          str += expression[i];
        } else {
          str += expression[i];
        }
        i++;
      }
      i++; // Skip closing quote
      tokens.push({ type: 'STRING', value: str, raw: `${quote}${str}${quote}` });
      continue;
    }

    // Multi-character operators
    const twoChar = expression.substring(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(twoChar)) {
      tokens.push({ type: 'OPERATOR', value: twoChar, raw: twoChar });
      i += 2;
      continue;
    }

    // Single-character operators
    if (['>', '<', '!'].includes(char)) {
      tokens.push({ type: 'OPERATOR', value: char, raw: char });
      i++;
      continue;
    }

    // Parentheses
    if (char === '(') {
      tokens.push({ type: 'LPAREN', value: '(', raw: '(' });
      i++;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'RPAREN', value: ')', raw: ')' });
      i++;
      continue;
    }

    // Brackets for property access
    if (char === '[') {
      tokens.push({ type: 'LBRACKET', value: '[', raw: '[' });
      i++;
      continue;
    }
    if (char === ']') {
      tokens.push({ type: 'RBRACKET', value: ']', raw: ']' });
      i++;
      continue;
    }

    // Dot for property access
    if (char === '.') {
      tokens.push({ type: 'DOT', value: '.', raw: '.' });
      i++;
      continue;
    }

    // Identifiers and keywords (true, false, null, variables, etc.)
    if (/[a-zA-Z_]/.test(char)) {
      let ident = '';
      while (i < expression.length && /[a-zA-Z0-9_]/.test(expression[i])) {
        ident += expression[i];
        i++;
      }

      // Check for keywords
      if (ident === 'true') {
        tokens.push({ type: 'BOOLEAN', value: true, raw: ident });
      } else if (ident === 'false') {
        tokens.push({ type: 'BOOLEAN', value: false, raw: ident });
      } else if (ident === 'null') {
        tokens.push({ type: 'NULL', value: null, raw: ident });
      } else {
        tokens.push({ type: 'IDENTIFIER', value: ident, raw: ident });
      }
      continue;
    }

    throw new Error(`Unexpected character: ${char} at position ${i}`);
  }

  tokens.push({ type: 'EOF', value: '', raw: '' });
  return tokens;
}

/**
 * Parser and Evaluator
 * Recursive descent parser with precedence handling
 */
class ExpressionParser {
  private tokens: Token[];
  private pos = 0;
  private variables: Record<string, unknown>;

  constructor(tokens: Token[], variables: Record<string, unknown>) {
    this.tokens = tokens;
    this.variables = variables;
  }

  private current(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.current();
    this.pos++;
    return token;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private match(type: TokenType): boolean {
    if (this.current().type === type) {
      this.advance();
      return true;
    }
    return false;
  }

  parse(): unknown {
    const result = this.parseOr();
    if (this.current().type !== 'EOF') {
      throw new Error(`Unexpected token: ${this.current().raw}`);
    }
    return result;
  }

  // Lowest precedence: ||
  private parseOr(): unknown {
    let left = this.parseAnd();

    while (this.current().type === 'OPERATOR' && this.current().value === '||') {
      this.advance();
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }

    return left;
  }

  // Higher precedence: &&
  private parseAnd(): unknown {
    let left = this.parseComparison();

    while (this.current().type === 'OPERATOR' && this.current().value === '&&') {
      this.advance();
      const right = this.parseComparison();
      left = Boolean(left) && Boolean(right);
    }

    return left;
  }

  // Higher precedence: ==, !=, >, <, >=, <=
  private parseComparison(): unknown {
    let left = this.parseUnary();

    const comparisonOps = ['==', '!=', '>', '<', '>=', '<='];
    while (this.current().type === 'OPERATOR' && comparisonOps.includes(this.current().value as string)) {
      const op = this.advance().value as string;
      const right = this.parseUnary();

      switch (op) {
        case '==':
          left = left === right;
          break;
        case '!=':
          left = left !== right;
          break;
        case '>':
          left = (left as number) > (right as number);
          break;
        case '<':
          left = (left as number) < (right as number);
          break;
        case '>=':
          left = (left as number) >= (right as number);
          break;
        case '<=':
          left = (left as number) <= (right as number);
          break;
      }
    }

    return left;
  }

  // Unary: !
  private parseUnary(): unknown {
    if (this.current().type === 'OPERATOR' && this.current().value === '!') {
      this.advance();
      const operand = this.parseUnary();
      return !operand;
    }
    return this.parsePrimary();
  }

  // Primary: numbers, strings, booleans, null, identifiers, parentheses
  private parsePrimary(): unknown {
    const token = this.current();

    // Parentheses
    if (token.type === 'LPAREN') {
      this.advance();
      const result = this.parseOr();
      if (!this.match('RPAREN')) {
        throw new Error('Expected closing parenthesis');
      }
      return result;
    }

    // Literals
    if (token.type === 'NUMBER' || token.type === 'STRING' || token.type === 'BOOLEAN' || token.type === 'NULL') {
      this.advance();
      return token.value;
    }

    // Identifiers (variable access)
    if (token.type === 'IDENTIFIER') {
      return this.parseVariableAccess();
    }

    throw new Error(`Unexpected token: ${token.raw}`);
  }

  // Parse variable access: variables.field or variables['field']
  private parseVariableAccess(): unknown {
    const identifier = this.advance().value as string;

    // Must start with 'variables'
    if (identifier !== 'variables') {
      throw new Error(`Unknown identifier: ${identifier}. Use 'variables.fieldName' to access variables.`);
    }

    let value: unknown = this.variables;

    // Parse property access chain
    while (true) {
      // Dot notation: variables.field
      if (this.current().type === 'DOT') {
        this.advance();
        if (this.current().type !== 'IDENTIFIER') {
          throw new Error('Expected property name after dot');
        }
        const prop = this.advance().value as string;
        if (value !== null && typeof value === 'object') {
          value = (value as Record<string, unknown>)[prop];
        } else {
          return undefined;
        }
        continue;
      }

      // Bracket notation: variables['field']
      if (this.current().type === 'LBRACKET') {
        this.advance();
        const key = this.parseOr();
        if (!this.match('RBRACKET')) {
          throw new Error('Expected closing bracket');
        }
        if (value !== null && typeof value === 'object') {
          value = (value as Record<string, unknown>)[String(key)];
        } else {
          return undefined;
        }
        continue;
      }

      break;
    }

    return value;
  }
}

/**
 * Evaluate a condition expression against the given variables.
 *
 * @param expression - The condition expression to evaluate
 * @param variables - The variables object to evaluate against
 * @returns The result of the evaluation (typically a boolean)
 * @throws Error if the expression is invalid
 *
 * @example
 * evaluateCondition("variables.severity > 0.7", { severity: 0.8 })
 * // returns true
 *
 * @example
 * evaluateCondition("variables.category == 'weather' && variables.severity >= 0.5", { category: 'weather', severity: 0.6 })
 * // returns true
 */
export function evaluateCondition(expression: string, variables: Record<string, unknown>): boolean {
  if (!expression || typeof expression !== 'string') {
    throw new Error('Expression must be a non-empty string');
  }

  const trimmed = expression.trim();
  if (trimmed === '') {
    throw new Error('Expression cannot be empty');
  }

  try {
    const tokens = tokenize(trimmed);
    const parser = new ExpressionParser(tokens, variables);
    const result = parser.parse();

    // Convert result to boolean
    return Boolean(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to evaluate expression "${expression}": ${message}`);
  }
}

/**
 * Validate an expression without evaluating it.
 *
 * @param expression - The condition expression to validate
 * @returns An object with isValid and error properties
 */
export function validateExpression(expression: string): { isValid: boolean; error?: string } {
  try {
    const tokens = tokenize(expression.trim());
    // Try to parse with empty variables to check syntax
    new ExpressionParser(tokens, {}).parse();
    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Invalid expression',
    };
  }
}
