/**
 * Toggle Hook
 *
 * Simple boolean state toggle utility for managing open/closed states.
 *
 * @example Basic Usage
 * ```typescript
 * const [isOpen, toggle] = useToggle();
 *
 * return (
 *   <div>
 *     <button onClick={toggle}>Toggle</button>
 *     {isOpen && <div>Content</div>}
 *   </div>
 * );
 * ```
 *
 * @returns Tuple of [isOpen, toggle] - state and toggle function
 */

import { useState } from "react";

/**
 * Hook for boolean toggle state
 *
 * @returns [isOpen, toggle] - Current state and toggle function
 */
export const useToggle = (): [boolean, () => void] => {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = () => {
    setIsOpen(!isOpen);
  };
  return [isOpen, toggle];
};
