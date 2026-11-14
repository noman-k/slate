import type { CellValue, DatabaseView, DbRecord, Property, WorkspaceState } from './types';
import { descendants, trashPage } from './tree';

type FormulaValue = string | number | boolean | null;
type Token = { kind: 'number' | 'string' | 'name' | 'symbol'; value: string; start: number; end: number };

function tokenizeFormula(expression: string): Token[] {
  if (expression.length > 4000) throw new Error('Formula is too long');
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?)|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Za-z_][A-Za-z_0-9]*)|(==|!=|<=|>=|&&|\|\||[+\-*/%(),<>!]))/gy;
  let offset = 0;
  while (offset < expression.trimEnd().length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(expression);
    if (!match) throw new Error(`Unexpected expression at ${offset + 1}`);
    offset = pattern.lastIndex;
    const body: Omit<Token, 'start' | 'end'> = match[1] ? { kind: 'number', value: match[1] } : match[2] !== undefined || match[3] !== undefined ? { kind: 'string', value: (match[2] ?? match[3]).replace(/\\([\\"'])/g, '$1').replace(/\\n/g, '\n') } : match[4] ? { kind: 'name', value: match[4] } : { kind: 'symbol', value: match[5] };
    tokens.push({ ...body, start: match.index + match[0].length - match[0].trimStart().length, end: offset });
    if (tokens.length > 1000) throw new Error('Formula is too complex');
  }
  return tokens;
}

function formulaReferences(expression: string) {
  const references: { name: string; start: number; end: number }[] = [];
  const tokens = tokenizeFormula(expression);
  for (let index = 0; index < tokens.length - 3; index++) if (tokens[index].kind === 'name' && tokens[index].value === 'prop' && tokens[index + 1].value === '(' && tokens[index + 2].kind === 'string' && tokens[index + 3].value === ')') references.push({ name: tokens[index + 2].value, start: tokens[index + 2].start, end: tokens[index + 2].end });
  return references;
}

/** Small expression interpreter. Never executes JavaScript or resolves arbitrary names. */
export function evaluateFormula(expression: string, properties: Record<string, CellValue>, now = new Date()): FormulaValue {
  const tokens = tokenizeFormula(expression);
  let cursor = 0;
  const symbolAt = (index: number, value: string) => tokens[index]?.kind === 'symbol' && tokens[index].value === value;
  const number = (value: FormulaValue) => Number(value ?? 0);
  const functions: Record<string, (...args: FormulaValue[]) => FormulaValue> = {
    prop: (name) => { if (!Object.hasOwn(properties, String(name))) throw new Error(`Unknown property: ${name}`); const value = properties[String(name)]; return Array.isArray(value) ? value.join(', ') : value ?? null; },
    if: (condition, yes, no) => condition ? yes : no,
    empty: (value) => value === null || value === '',
    concat: (...values) => values.join(''),
    upper: (value) => String(value ?? '').toUpperCase(), lower: (value) => String(value ?? '').toLowerCase(),
    length: (value) => String(value ?? '').length, contains: (a, b) => String(a ?? '').includes(String(b ?? '')),
    replace: (value, search, replacement) => String(value ?? '').split(String(search)).join(String(replacement)),
    round: (value, digits = 0) => { const factor = 10 ** Math.min(10, Math.max(0, number(digits))); return Math.round(number(value) * factor) / factor; },
    abs: (value) => Math.abs(number(value)), ceil: (value) => Math.ceil(number(value)), floor: (value) => Math.floor(number(value)),
    min: (...values) => Math.min(...values.map(number)), max: (...values) => Math.max(...values.map(number)), sum: (...values) => values.reduce<number>((total, value) => total + number(value), 0),
    now: () => now.toISOString(), today: () => now.toISOString().slice(0, 10),
    dateBetween: (a, b, unit = 'days') => { const milliseconds = new Date(String(a)).getTime() - new Date(String(b)).getTime(); return Math.trunc(milliseconds / (unit === 'hours' ? 3600000 : unit === 'minutes' ? 60000 : 86400000)); },
    dateAdd: (date, amount, unit = 'days') => new Date(new Date(String(date)).getTime() + number(amount) * (unit === 'hours' ? 3600000 : 86400000)).toISOString(),
    toNumber: number, toString: (value: FormulaValue) => String(value ?? ''),
  };
  const precedence: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
  function expressionAt(minimum = 0, depth = 0, evaluate = true): FormulaValue {
    if (depth > 40) throw new Error('Formula nesting limit reached');
    const token = tokens[cursor++];
    if (!token) throw new Error('Expected a value');
    let left: FormulaValue;
    if (token.kind === 'symbol' && token.value === '(') { left = expressionAt(0, depth + 1, evaluate); if (!symbolAt(cursor++, ')')) throw new Error('Expected closing parenthesis'); }
    else if (token.kind === 'symbol' && (token.value === '!' || token.value === '-')) { const operand = expressionAt(7, depth + 1, evaluate); left = token.value === '!' ? !operand : -number(operand); }
    else if (token.kind === 'number') left = Number(token.value);
    else if (token.kind === 'string') left = token.value;
    else if (token.kind === 'name') {
      if (['true', 'false', 'null'].includes(token.value)) left = token.value === 'null' ? null : token.value === 'true';
      else {
        const fn = Object.hasOwn(functions, token.value) ? functions[token.value] : undefined;
        if (!fn) throw new Error(`Unknown function: ${token.value}`);
        if (!symbolAt(cursor++, '(')) throw new Error('Expected a function call');
        const args: FormulaValue[] = [];
        while (!symbolAt(cursor, ')')) { const evaluateArgument = evaluate && (token.value !== 'if' || args.length === 0 || (args.length === 1 ? Boolean(args[0]) : !args[0])); args.push(expressionAt(0, depth + 1, evaluateArgument)); if (!symbolAt(cursor, ',')) break; cursor++; }
        if (!symbolAt(cursor++, ')')) throw new Error('Expected closing parenthesis');
        left = evaluate ? fn(...args) : null;
      }
    } else throw new Error('Expected a value');
    while (cursor < tokens.length && tokens[cursor].kind === 'symbol' && (precedence[tokens[cursor].value] ?? -1) >= minimum) {
      const operator = tokens[cursor++].value;
      const evaluateRight = evaluate && (operator !== '&&' || Boolean(left)) && (operator !== '||' || !left);
      const right = expressionAt(precedence[operator] + 1, depth + 1, evaluateRight);
      if (!evaluate) { left = null; continue; }
      switch (operator) {
        case '+': left = typeof left === 'string' || typeof right === 'string' ? String(left ?? '') + String(right ?? '') : number(left) + number(right); break;
        case '-': left = number(left) - number(right); break;
        case '*': left = number(left) * number(right); break;
        case '/': if (number(right) === 0) throw new Error('Division by zero'); left = number(left) / number(right); break;
        case '%': left = number(left) % number(right); break;
        case '==': left = left === right; break;
        case '!=': left = left !== right; break;
        case '>': left = number(left) > number(right); break;
        case '<': left = number(left) < number(right); break;
        case '>=': left = number(left) >= number(right); break;
        case '<=': left = number(left) <= number(right); break;
        case '&&': left = Boolean(left && right); break;
        case '||': left = Boolean(left || right); break;
      }
    }
    return left;
  }
  const result = expressionAt();
  if (cursor !== tokens.length) throw new Error('Unexpected trailing input');
  if (typeof result === 'number' && !Number.isFinite(result)) throw new Error('Result is not a finite number');
  return result;
}

export function recordTitle(record: DbRecord, state: WorkspaceState) {
  const property = state.properties.find((item) => item.database_id === record.database_id && item.type === 'title');
  return String(property ? record.values[property.id] || 'Untitled' : 'Untitled');
}

export function cellValue(record: DbRecord, property: Property, state: WorkspaceState, visited = new Set<string>()): CellValue {
  const key = `${record.id}:${property.id}`;
  if (visited.has(key)) return '#Circular reference';
  const nextVisited = new Set(visited).add(key);
  if (property.type === 'created_time') return record.created_at;
  if (property.type === 'updated_time') return record.updated_at;
  if (property.type === 'formula') {
    try {
      const values: Record<string, CellValue> = {};
      const references = new Set(formulaReferences(property.config.expression || '0').map((reference) => reference.name));
      if (references.has(property.name)) throw new Error('Circular reference');
      for (const item of state.properties.filter((p) => p.database_id === record.database_id && p.id !== property.id)) {
        // Resolve only referenced computed properties, avoiding artificial cycles.
        if (item.type !== 'formula' && item.type !== 'rollup' || references.has(item.name)) { const value = cellValue(record, item, state, nextVisited); if (['formula', 'rollup'].includes(item.type) && typeof value === 'string' && value.startsWith('#')) throw new Error(value.slice(1)); values[item.name] = value; }
      }
      return evaluateFormula(property.config.expression || '0', values);
    } catch (error) { return `#${error instanceof Error ? error.message : 'Formula error'}`; }
  }
  if (property.type === 'rollup') {
    const relation = state.properties.find((p) => p.id === property.config.relation_property_id);
    const relationIds = relation ? cellValue(record, relation, state, nextVisited) : [];
    const related = state.records.filter((r) => Array.isArray(relationIds) && relationIds.includes(r.id));
    if (property.config.aggregation === 'count' || !property.config.aggregation) return related.length;
    const target = state.properties.find((p) => p.id === property.config.rollup_property_id);
    if (!target) return null;
    const values = related.map((r) => cellValue(r, target, state, nextVisited));
    if (property.config.aggregation === 'values') return values.map(String).join(', ');
    const numbers = values.filter((value) => value !== null && value !== '').map(Number).filter(Number.isFinite);
    if (!numbers.length) return 0;
    switch (property.config.aggregation) {
      case 'sum': return numbers.reduce((a, b) => a + b, 0);
      case 'average': return numbers.reduce((a, b) => a + b, 0) / numbers.length;
      case 'min': return Math.min(...numbers);
      case 'max': return Math.max(...numbers);
      default: return null;
    }
  }
  if (property.type === 'relation') {
    const ids = record.values[property.id];
    return Array.isArray(ids) ? ids.filter((id) => {
      const target = state.records.find((item) => item.id === id);
      return target && target.database_id === property.config.related_database_id && !state.pages.find((page) => page.id === target.page_id)?.deleted_at;
    }) : [];
  }
  return record.values[property.id] ?? null;
}

/** Views can order the same shared properties independently; new properties use schema order. */
export function orderProperties(properties: Property[], order: string[] = []): Property[] {
  const fallback = [...properties].sort((a, b) => a.position - b.position);
  const ids = new Set(properties.map((property) => property.id));
  const orderedIds = [...new Set([...fallback.filter((property) => property.type === 'title').map((property) => property.id), ...order.filter((id) => ids.has(id)), ...fallback.map((property) => property.id)])];
  const positions = new Map(orderedIds.map((id, index) => [id, index]));
  return fallback.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
}

export function visibleRecords(databaseId: string, view: DatabaseView, state: WorkspaceState, search = '') {
  const properties = state.properties.filter((p) => p.database_id === databaseId);
  const get = (record: DbRecord, propertyId: string) => { const p = properties.find((item) => item.id === propertyId); return p ? cellValue(record, p, state) : null; };
  return state.records.filter((record) => record.database_id === databaseId && !state.pages.find((p) => p.id === record.page_id)?.deleted_at)
    .filter((record) => !search || properties.some((property) => !property.config.system && String(cellValue(record, property, state) ?? '').toLowerCase().includes(search.toLowerCase())))
    .filter((record) => view.filters.every((filter) => {
      const value = get(record, filter.property_id);
      const text = String(value ?? '').toLowerCase();
      switch (filter.operator) {
        case 'contains': return text.includes(filter.value.toLowerCase());
        case 'equals': return text === filter.value.toLowerCase();
        case 'not_equals': return text !== filter.value.toLowerCase();
        case 'is_empty': return value === null || value === '' || Array.isArray(value) && value.length === 0;
        case 'greater_than': return Number(value) > Number(filter.value);
        case 'less_than': return Number(value) < Number(filter.value);
      }
    }))
    .sort((a, b) => {
      for (const sort of view.sorts) {
        const av = get(a, sort.property_id), bv = get(b, sort.property_id);
        const difference = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
        if (difference) return sort.direction === 'asc' ? difference : -difference;
      }
      return a.position - b.position;
    });
}

export function updateCell(state: WorkspaceState, recordId: string, property: Property, value: CellValue): WorkspaceState {
  const now = new Date().toISOString();
  const record = state.records.find((r) => r.id === recordId);
  if (!record) return state;
  if (property.type === 'relation' && Array.isArray(value)) {
    const sourceWorkspace = state.databases.find((database) => database.id === property.database_id)?.workspace_id;
    const targetDatabase = state.databases.find((database) => database.id === property.config.related_database_id);
    for (const targetId of value) {
      const target = state.records.find((item) => item.id === targetId);
      if (!target || target.database_id !== targetDatabase?.id || sourceWorkspace !== targetDatabase?.workspace_id || state.pages.find((page) => page.id === target.page_id)?.deleted_at) throw new Error('Related records must belong to the configured database and workspace');
    }
  }
  let records = state.records.map((r) => r.id === recordId ? { ...r, values: { ...r.values, [property.id]: value }, updated_at: now } : r);
  const candidate = state.properties.find((item) => item.id === property.config.reciprocal_property_id);
  const reciprocal = candidate?.type === 'relation' && candidate.database_id === property.config.related_database_id && candidate.config.related_database_id === property.database_id ? candidate.id : '';
  if (property.type === 'relation' && reciprocal) {
    const old = record.values[property.id];
    const before = Array.isArray(old) ? old : [], after = Array.isArray(value) ? value : [];
    records = records.map((r) => {
      if (!before.includes(r.id) && !after.includes(r.id)) return r;
      const existing = r.values[reciprocal];
      const ids = (Array.isArray(existing) ? existing : []).filter((id) => id !== recordId);
      if (after.includes(r.id)) ids.push(recordId);
      return { ...r, values: { ...r.values, [reciprocal]: ids }, updated_at: now };
    });
  }
  return { ...state, records, pages: property.type === 'title' ? state.pages.map((p) => p.id === record.page_id ? { ...p, title: String(value || 'Untitled'), updated_at: now } : p) : state.pages };
}

export function removeRecord(state: WorkspaceState, recordId: string): WorkspaceState {
  const record = state.records.find((r) => r.id === recordId);
  if (!record) return state;
  const deletedPageIds = new Set([record.page_id, ...descendants(state.pages, record.page_id)]);
  const deletedRecordIds = new Set(state.records.filter((item) => deletedPageIds.has(item.page_id)).map((item) => item.id));
  const relationIds = new Set(state.properties.filter((p) => p.type === 'relation').map((p) => p.id));
  const trashed = trashPage(state, record.page_id);
  return { ...trashed, records: trashed.records.map((r) => ({ ...r, values: Object.fromEntries(Object.entries(r.values).map(([key, value]) => [key, relationIds.has(key) && Array.isArray(value) ? value.filter((id) => !deletedRecordIds.has(id)) : value])) })) };
}

/**
 * Undo for `removeRecord`: restores the trashed page tree and re-adds only the relation
 * links that the removal stripped, so edits made in the meantime are kept.
 */
export function restoreRemovedRecord(state: WorkspaceState, before: WorkspaceState, recordId: string): WorkspaceState {
  const record = before.records.find((item) => item.id === recordId);
  if (!record) return state;
  const restoredPageIds = new Set([record.page_id, ...descendants(before.pages, record.page_id)]);
  const restoredRecordIds = new Set(before.records.filter((item) => restoredPageIds.has(item.page_id)).map((item) => item.id));
  const relationIds = new Set(before.properties.filter((p) => p.type === 'relation').map((p) => p.id));
  const previous = new Map(before.records.map((item) => [item.id, item]));
  const restored = trashPage(state, record.page_id, true);
  return { ...restored, records: restored.records.map((current) => {
    const old = previous.get(current.id);
    if (!old) return current;
    let values = current.values;
    for (const [key, value] of Object.entries(old.values)) {
      if (!relationIds.has(key) || !Array.isArray(value)) continue;
      const lost = value.filter((id) => restoredRecordIds.has(id));
      if (!lost.length) continue;
      const now = Array.isArray(values[key]) ? (values[key] as string[]) : [];
      values = { ...values, [key]: [...now, ...lost.filter((id) => !now.includes(id))] };
    }
    return values === current.values ? current : { ...current, values };
  }) };
}

/** Keep formula references attached to a property when its display name changes. */
export function renameProperty(state: WorkspaceState, propertyId: string, name: string): WorkspaceState {
  const property = state.properties.find((item) => item.id === propertyId);
  if (!property || name === property.name) return state;
  return { ...state, properties: state.properties.map((item) => {
    if (item.id === propertyId) return { ...item, name };
    if (item.database_id !== property.database_id || item.type !== 'formula' || !item.config.expression) return item;
    try {
      let expression = item.config.expression;
      for (const reference of formulaReferences(expression).filter((reference) => reference.name === property.name).reverse()) expression = expression.slice(0, reference.start) + JSON.stringify(name) + expression.slice(reference.end);
      return { ...item, config: { ...item.config, expression } };
    } catch { return item; }
  }) };
}

export function duplicateProperty(state: WorkspaceState, propertyId: string): WorkspaceState {
  const property = state.properties.find((item) => item.id === propertyId);
  if (!property) return state;
  if (property.type === 'title') throw new Error('The title property cannot be duplicated');
  const copyId = crypto.randomUUID();
  const config = { ...property.config };
  // A copied relation is independent; sharing an inverse would conflate the two properties.
  delete config.reciprocal_property_id;
  const copy: Property = { ...property, id: copyId, config, name: `${property.name} copy`, position: Math.max(...state.properties.filter((item) => item.database_id === property.database_id).map((item) => item.position), 0) + 1 };
  return { ...state, properties: [...state.properties, copy], records: state.records.map((record) => {
    if (record.database_id !== property.database_id) return record;
    const value = property.type === 'relation' ? cellValue(record, property, state) : record.values[propertyId] ?? null;
    return { ...record, values: { ...record.values, [copyId]: Array.isArray(value) ? [...value] : value } };
  }) };
}

/** Delete a property together with all view/configuration references to it. */
export function removeProperty(state: WorkspaceState, propertyId: string): WorkspaceState {
  const property = state.properties.find((item) => item.id === propertyId);
  if (!property) return state;
  if (property.type === 'title') throw new Error('The title property cannot be deleted');
  let next = state;
  if (property.type === 'relation') for (const record of state.records.filter((item) => item.database_id === property.database_id)) next = updateCell(next, record.id, property, []);
  return {
    ...next,
    properties: next.properties.filter((item) => item.id !== propertyId).map((item) => {
      const config = { ...item.config };
      for (const reference of ['relation_property_id', 'rollup_property_id', 'reciprocal_property_id']) if (config[reference] === propertyId) delete config[reference];
      return { ...item, config };
    }),
    records: next.records.map((record) => { const values = { ...record.values }; delete values[propertyId]; return { ...record, values }; }),
    views: next.views.map((view) => ({ ...view, filters: view.filters.filter((filter) => filter.property_id !== propertyId), sorts: view.sorts.filter((sort) => sort.property_id !== propertyId), hidden_properties: view.hidden_properties.filter((id) => id !== propertyId), property_order: view.property_order?.filter((id) => id !== propertyId), group_by: view.group_by === propertyId ? undefined : view.group_by })),
  };
}

export function csvExport(records: DbRecord[], properties: Property[], state: WorkspaceState) {
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [properties.map((p) => escape(p.name)).join(','), ...records.map((r) => properties.map((p) => { const value = cellValue(r, p, state); return escape(p.type === 'relation' && Array.isArray(value) ? value.map((id) => { const linked = state.records.find((item) => item.id === id); return linked ? recordTitle(linked, state) : ''; }).join(', ') : value); }).join(','))].join('\r\n');
}
