import { mapStoredRules } from "./view-filters";
import type { CellValue, Document, Property, WorkspaceState } from "./types";
import { decodeDirective, encodeDirective, joinMarkdown, splitMarkdown } from "./markdown";

export interface DuplicatePageOptions {
  /** Allocate this before calling a React state updater so navigation can use it. */
  rootId?: string;
  generateId?: () => string;
  now?: string;
  suffix?: string;
}

/**
 * Copies a visible page subtree and every normalized entity owned by its databases.
 * Internal references follow the copies; links outside the subtree retain their IDs.
 * The input state and all its nested objects remain unchanged.
 */
export function duplicatePageSubtree(
  state: WorkspaceState,
  rootPageId: string,
  options: DuplicatePageOptions = {},
): WorkspaceState {
  const root = state.pages.find((page) => page.id === rootPageId && !page.deleted_at);
  if (!root) return state;
  const workspacePages = state.pages.filter((page) => page.workspace_id === root.workspace_id && !page.deleted_at);
  const pageIds = new Set([rootPageId]);
  const databaseIds = new Set<string>();
  const pageById = new Map(workspacePages.map((page) => [page.id, page]));
  const children = new Map<string, string[]>();
  for (const page of workspacePages)
    if (page.parent_id) children.set(page.parent_id, [...(children.get(page.parent_id) ?? []), page.id]);
  const databaseByPage = new Map(
    state.databases
      .filter((database) => database.workspace_id === root.workspace_id)
      .map((database) => [database.page_id, database]),
  );
  const recordPagesByDatabase = new Map<string, string[]>();
  for (const record of state.records)
    recordPagesByDatabase.set(record.database_id, [
      ...(recordPagesByDatabase.get(record.database_id) ?? []),
      record.page_id,
    ]);
  // Record pages are database-owned even if imported data has a different tree parent.
  // A queue handles arbitrarily deep trees without recursion or repeated full scans.
  const queue = [rootPageId];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const pageId = queue[cursor];
    const database = databaseByPage.get(pageId);
    if (database) databaseIds.add(database.id);
    const ownedPages = [
      ...(children.get(pageId) ?? []),
      ...(database ? (recordPagesByDatabase.get(database.id) ?? []) : []),
    ];
    for (const ownedId of ownedPages)
      if (pageById.has(ownedId) && !pageIds.has(ownedId)) {
        pageIds.add(ownedId);
        queue.push(ownedId);
      }
  }
  const pages = workspacePages.filter((page) => pageIds.has(page.id));
  const databases = state.databases.filter((database) => databaseIds.has(database.id));
  const properties = state.properties.filter((property) => databaseIds.has(property.database_id));
  const records = state.records.filter((record) => pageIds.has(record.page_id));
  // Linked database blocks inside the copied pages get new ids, and their own views
  // are copied with them, so the copy's views don't change the original's.
  const blocks = new Set(
    state.documents
      .filter((document) => pageIds.has(document.page_id))
      .flatMap((document) => splitMarkdown(document.markdown))
      .flatMap((part) => (part.kind === "embed" && part.directive.block ? [part.directive.block] : [])),
  );
  const views = state.views.filter((view) =>
    view.placement ? blocks.has(view.placement) : databaseIds.has(view.database_id),
  );
  const usedIds = new Set(
    [
      ...state.pages,
      ...state.databases,
      ...state.properties,
      ...state.records,
      ...state.views,
      ...state.workspaces,
    ].map((entity) => entity.id),
  );
  const generate = options.generateId ?? (() => crypto.randomUUID());
  const fresh = (provided?: string) => {
    const next = provided ?? generate();
    if (!next || usedIds.has(next)) throw new Error("A duplicate page must have a new unique ID.");
    usedIds.add(next);
    return next;
  };
  const pageMap = new Map<string, string>([[rootPageId, fresh(options.rootId)]]);
  for (const page of pages) if (page.id !== rootPageId) pageMap.set(page.id, fresh());
  const databaseMap = new Map(databases.map((database) => [database.id, fresh()]));
  const propertyMap = new Map(properties.map((property) => [property.id, fresh()]));
  const recordMap = new Map(records.map((record) => [record.id, fresh()]));
  const viewMap = new Map(views.map((view) => [view.id, fresh()]));
  const placementMap = new Map([...blocks].map((block) => [block, generate()]));
  const allMaps = new Map([...pageMap, ...databaseMap, ...propertyMap, ...recordMap, ...viewMap]);
  const now = options.now ?? new Date().toISOString();
  const copiedRootTitle = `${root.title}${options.suffix ?? " (copy)"}`;

  /** Rewrite structured IDs, never arbitrary prose or string cell values. */
  const remapStructured = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(remapStructured);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        typeof item === "string" && (key === "id" || key === "viewId" || key.endsWith("_id"))
          ? (allMaps.get(item) ?? item)
          : remapStructured(item),
      ]),
    );
  };
  const remapDocument = (document: Document): Document => ({
    ...structuredClone(document),
    page_id: pageMap.get(document.page_id)!,
    markdown: joinMarkdown(
      splitMarkdown(document.markdown).map((part) => {
        if (part.kind === "embed") {
          const directive = decodeDirective(part.source)!;
          const mapped = {
            ...directive,
            id:
              directive.kind === "database"
                ? (databaseMap.get(directive.id) ?? directive.id)
                : (pageMap.get(directive.id) ?? directive.id),
            ...(directive.viewId ? { viewId: viewMap.get(directive.viewId) ?? directive.viewId } : {}),
            ...(directive.block ? { block: placementMap.get(directive.block) ?? directive.block } : {}),
          };
          return {
            ...part,
            directive: mapped,
            source: encodeDirective(mapped),
          };
        }
        if (part.kind === "rich") {
          const node = remapStructured(part.node) as Record<string, unknown>;
          return {
            ...part,
            node,
            source: `:::slate-node ${JSON.stringify(node)}`,
          };
        }
        // Code examples and unknown syntax are intentionally preserved byte-for-byte.
        return part;
      }),
    ),
    ...(document.content !== undefined ? { content: remapStructured(document.content) } : {}),
    updated_at: now,
  });
  const propertyById = new Map(state.properties.map((property) => [property.id, property]));
  const recordById = new Map(state.records.map((record) => [record.id, record]));
  const remapValues = (record: WorkspaceState["records"][number]): Record<string, CellValue> =>
    Object.fromEntries(
      Object.entries(record.values).map(([propertyId, value]) => {
        const property = propertyById.get(propertyId);
        let next = structuredClone(value);
        if (property?.type === "relation" && Array.isArray(next)) {
          const clonedProperty = propertyMap.has(propertyId);
          next = next
            .filter((id) => {
              const target = recordById.get(id);
              if (
                !target ||
                !pageById.has(target.page_id) ||
                target.database_id !== property.config.related_database_id
              )
                return false;
              // A copied target database can only contain its copied, visible records.
              return !clonedProperty || !databaseMap.has(target.database_id) || recordMap.has(id);
            })
            .map((id) => (clonedProperty ? (recordMap.get(id) ?? id) : id));
        }
        if (property?.type === "title" && record.page_id === rootPageId) next = copiedRootTitle;
        return [propertyMap.get(propertyId) ?? propertyId, next];
      }),
    );
  const copiedProperties = properties.map((property) => {
    const config = remapStructured(structuredClone(property.config)) as Property["config"];
    // An external reciprocal property still targets the original database. Keep the
    // copied relation one-way rather than write invalid copied IDs into that property.
    const reciprocal = property.config.reciprocal_property_id;
    if (typeof reciprocal === "string" && !propertyMap.has(reciprocal)) delete config.reciprocal_property_id;
    return {
      ...property,
      id: propertyMap.get(property.id)!,
      database_id: databaseMap.get(property.database_id)!,
      config,
    };
  });
  const copiedRecords = records.map((record) => ({
    ...record,
    id: recordMap.get(record.id)!,
    database_id: databaseMap.get(record.database_id) ?? record.database_id,
    page_id: pageMap.get(record.page_id)!,
    values: remapValues(record),
    created_at: now,
    updated_at: now,
  }));
  // Duplicating a record page in an existing database reuses that database's
  // properties. Add its inverse links without modifying any original selections.
  const reciprocalAdditions = new Map<string, Map<string, Set<string>>>();
  for (let index = 0; index < records.length; index++) {
    if (databaseMap.has(records[index].database_id)) continue;
    const copy = copiedRecords[index];
    for (const [propertyId, value] of Object.entries(copy.values)) {
      const property = propertyById.get(propertyId);
      const reciprocal = property?.config.reciprocal_property_id;
      if (property?.type !== "relation" || typeof reciprocal !== "string" || !Array.isArray(value)) continue;
      for (const targetId of value) {
        const additions = reciprocalAdditions.get(targetId) ?? new Map<string, Set<string>>();
        const inverseIds = additions.get(reciprocal) ?? new Set<string>();
        inverseIds.add(copy.id);
        additions.set(reciprocal, inverseIds);
        reciprocalAdditions.set(targetId, additions);
      }
    }
  }
  const existingRecords = state.records.map((record) => {
    const additions = reciprocalAdditions.get(record.id);
    if (!additions) return record;
    const values = { ...record.values };
    for (const [propertyId, addedIds] of additions) {
      const current = values[propertyId];
      values[propertyId] = [...new Set([...(Array.isArray(current) ? current : []), ...addedIds])];
    }
    return { ...record, values, updated_at: now };
  });
  const recordByPage = new Map(state.records.map((record) => [record.page_id, record]));
  const databaseById = new Map(state.databases.map((database) => [database.id, database]));
  const copiedParent = (pageId: string, parentId: string | null) => {
    if (pageId === rootPageId) return root.parent_id;
    if (parentId && pageMap.has(parentId)) return pageMap.get(parentId)!;
    const record = recordByPage.get(pageId);
    const database = record ? databaseById.get(record.database_id) : undefined;
    if (database && databaseMap.has(database.id)) return pageMap.get(database.page_id)!;
    return parentId;
  };
  return {
    ...state,
    pages: [
      ...state.pages,
      ...pages.map((page) => ({
        ...page,
        id: pageMap.get(page.id)!,
        parent_id: copiedParent(page.id, page.parent_id),
        title: page.id === rootPageId ? copiedRootTitle : page.title,
        ...(page.database_id
          ? {
              database_id: databaseMap.get(page.database_id) ?? page.database_id,
            }
          : {}),
        position:
          page.id === rootPageId
            ? Math.max(
                -1,
                ...state.pages
                  .filter(
                    (sibling) => sibling.workspace_id === root.workspace_id && sibling.parent_id === root.parent_id,
                  )
                  .map((sibling) => sibling.position),
              ) + 1
            : page.position,
        favorite: false,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      })),
    ],
    documents: [
      ...state.documents,
      ...state.documents.filter((document) => pageIds.has(document.page_id)).map(remapDocument),
    ],
    databases: [
      ...state.databases,
      ...databases.map((database) => ({
        ...database,
        id: databaseMap.get(database.id)!,
        page_id: pageMap.get(database.page_id)!,
        name: database.page_id === rootPageId ? copiedRootTitle : database.name,
      })),
    ],
    properties: [...state.properties, ...copiedProperties],
    records: [...existingRecords, ...copiedRecords],
    views: [
      ...state.views,
      ...views.map((view) => ({
        ...structuredClone(view),
        id: viewMap.get(view.id)!,
        database_id: databaseMap.get(view.database_id) ?? view.database_id,
        ...(view.placement ? { placement: placementMap.get(view.placement) ?? view.placement } : {}),
        filters: mapStoredRules(view.filters, (filter) => ({
          ...filter,
          property_id: propertyMap.get(filter.property_id) ?? filter.property_id,
          value:
            propertyById.get(filter.property_id)?.type === "relation"
              ? (recordMap.get(filter.value) ?? filter.value)
              : filter.value,
        })),
        sorts: view.sorts.map((sort) => ({
          ...sort,
          property_id: propertyMap.get(sort.property_id) ?? sort.property_id,
        })),
        hidden_properties: view.hidden_properties.map((id) => propertyMap.get(id) ?? id),
        ...("property_order" in view && Array.isArray(view.property_order)
          ? {
              property_order: view.property_order.map(
                (propertyId: string) => propertyMap.get(propertyId) ?? propertyId,
              ),
            }
          : {}),
        ...(view.group_by ? { group_by: propertyMap.get(view.group_by) ?? view.group_by } : {}),
      })),
    ],
  };
}
