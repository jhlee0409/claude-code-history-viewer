import type {
  ContentType,
  RendererRegistration,
  BaseContentRendererProps
} from './types';

/**
 * Internal registry mapping content types to their renderers.
 * Populated via registerRenderer() calls during module initialization.
 */
const registry = new Map<ContentType, RendererRegistration>();

/**
 * Register a content renderer in the global registry.
 * Should be called during module initialization to populate the registry.
 *
 * @param registration - Renderer configuration (type, component, optional priority)
 * @example
 * registerRenderer({
 *   type: 'text',
 *   component: TextContentRenderer,
 *   priority: 10
 * });
 */
export function registerRenderer(registration: RendererRegistration): void {
  registry.set(registration.type, registration);
}

/**
 * Retrieve a registered renderer component for a given content type.
 *
 * @param type - Content type string to lookup
 * @returns Renderer component or null if type is not registered
 * @example
 * const Renderer = getRenderer('text');
 * if (Renderer) {
 *   return <Renderer content={item} context={ctx} index={0} />;
 * }
 */
export function getRenderer(type: string): React.ComponentType<BaseContentRendererProps> | null {
  const reg = registry.get(type as ContentType);
  return reg?.component ?? null;
}

/**
 * Retrieve the full registration entry for a content type.
 * Includes priority and other metadata.
 *
 * @param type - Content type string to lookup
 * @returns Full registration object or null if not found
 */
export function getRegistration(type: string): RendererRegistration | null {
  return registry.get(type as ContentType) ?? null;
}

/**
 * Type guard to check if a string is a registered content type.
 *
 * @param type - String to check
 * @returns True if type is registered, false otherwise
 * @example
 * if (isRegisteredType(item.type)) {
 *   // TypeScript now knows item.type is ContentType
 *   const renderer = getRenderer(item.type);
 * }
 */
export function isRegisteredType(type: string): type is ContentType {
  return registry.has(type as ContentType);
}

// Re-export all types for convenience
export type {
  ContentType,
  RendererRegistration,
  RenderContext,
  BaseContentRendererProps
} from './types';
