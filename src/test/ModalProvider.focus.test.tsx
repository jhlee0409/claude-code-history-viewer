import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ModalProvider } from "@/contexts/modal/ModalProvider";
import { useModal } from "@/contexts/modal";

const ModalHarness = () => {
  const { isOpen, openModal, closeModal, closeAllModals } = useModal();

  return (
    <div>
      <button type="button" onClick={() => openModal("feedback")} data-testid="open-feedback">
        open-feedback
      </button>
      <button type="button" onClick={() => openModal("globalSearch")} data-testid="open-search">
        open-search
      </button>
      <button type="button" onClick={() => closeModal("feedback")} data-testid="close-feedback">
        close-feedback
      </button>
      <button type="button" onClick={() => closeModal("globalSearch")} data-testid="close-search">
        close-search
      </button>
      <button type="button" onClick={() => closeAllModals()} data-testid="close-all">
        close-all
      </button>
      <div data-testid="feedback-state">{String(isOpen("feedback"))}</div>
      <div data-testid="search-state">{String(isOpen("globalSearch"))}</div>
    </div>
  );
};

describe("ModalProvider focus restoration", () => {
  it("returns focus to opener when closing a modal", async () => {
    render(
      <ModalProvider>
        <ModalHarness />
      </ModalProvider>
    );

    const openFeedback = screen.getByTestId("open-feedback");
    openFeedback.focus();
    fireEvent.click(openFeedback);
    fireEvent.click(screen.getByTestId("close-feedback"));

    await waitFor(() => {
      expect(document.activeElement).toBe(openFeedback);
    });
  });

  it("returns focus to most recently opened modal trigger on closeAllModals", async () => {
    render(
      <ModalProvider>
        <ModalHarness />
      </ModalProvider>
    );

    const openFeedback = screen.getByTestId("open-feedback");
    const openSearch = screen.getByTestId("open-search");

    fireEvent.click(openFeedback);
    openSearch.focus();
    fireEvent.click(openSearch);
    fireEvent.click(screen.getByTestId("close-all"));

    await waitFor(() => {
      expect(document.activeElement).toBe(openSearch);
    });
  });
});
