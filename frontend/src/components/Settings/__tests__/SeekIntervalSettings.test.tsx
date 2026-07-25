import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerSeekIntervals } from "../../../utils/playerSeekIntervals";
import SeekIntervalSettings from "../SeekIntervalSettings";

vi.mock("../../../contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

interface HarnessProps {
  initialIntervals?: PlayerSeekIntervals;
  onChangeSpy?: (field: string, value: number) => void;
  onValidityChange: (valid: boolean) => void;
}

function Harness({
  initialIntervals = {
    shortSeconds: 10,
    mediumSeconds: 60,
    longSeconds: 600,
  },
  onChangeSpy,
  onValidityChange,
}: HarnessProps) {
  const [intervals, setIntervals] =
    useState<PlayerSeekIntervals>(initialIntervals);

  return (
    <SeekIntervalSettings
      intervals={intervals}
      onChange={(field, value) => {
        onChangeSpy?.(field, value);
        const intervalKey =
          field === "playerSeekShortSeconds"
            ? "shortSeconds"
            : field === "playerSeekMediumSeconds"
              ? "mediumSeconds"
              : "longSeconds";
        setIntervals((current) => ({ ...current, [intervalKey]: value }));
      }}
      onValidityChange={onValidityChange}
    />
  );
}

describe("SeekIntervalSettings", () => {
  const onValidityChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders defaults using exact natural units", () => {
    render(<Harness onValidityChange={onValidityChange} />);

    expect(
      screen.getByRole("group", { name: "seekControls" })
    ).toHaveStyle({
      display: "flex",
      flexDirection: "column",
      maxWidth: "420px",
    });
    expect(screen.getByLabelText("seekShortInterval")).toHaveValue(10);
    expect(screen.getByLabelText("seekMediumInterval")).toHaveValue(1);
    expect(screen.getByLabelText("seekLongInterval")).toHaveValue(10);
    expect(screen.getAllByText("seekUnitMinutes")).toHaveLength(2);
  });

  it("converts a valid amount to canonical seconds", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        onChangeSpy={onChange}
        onValidityChange={onValidityChange}
      />
    );

    const shortInput = screen.getByLabelText("seekShortInterval");
    await user.clear(shortInput);
    await user.type(shortInput, "15");

    expect(onChange).toHaveBeenLastCalledWith("playerSeekShortSeconds", 15);
  });

  it("preserves invalid text and reports invalidity while editing", async () => {
    const user = userEvent.setup();
    render(<Harness onValidityChange={onValidityChange} />);

    const shortInput = screen.getByLabelText("seekShortInterval");
    await user.clear(shortInput);

    expect(shortInput).toHaveValue(null);
    expect(screen.getByText("seekIntervalRangeError")).toBeInTheDocument();
    await waitFor(() =>
      expect(onValidityChange).toHaveBeenLastCalledWith(false)
    );
  });

  it("shows an ordering error when short is not less than medium", async () => {
    const user = userEvent.setup();
    render(<Harness onValidityChange={onValidityChange} />);

    const shortInput = screen.getByLabelText("seekShortInterval");
    await user.clear(shortInput);
    await user.type(shortInput, "120");

    expect(screen.getByText("seekIntervalOrderError")).toBeInTheDocument();
    await waitFor(() =>
      expect(onValidityChange).toHaveBeenLastCalledWith(false)
    );
  });

  it("resets all three intervals to their defaults", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        initialIntervals={{
          shortSeconds: 15,
          mediumSeconds: 120,
          longSeconds: 900,
        }}
        onChangeSpy={onChange}
        onValidityChange={onValidityChange}
      />
    );

    await user.click(screen.getByRole("button", { name: "resetSeekIntervals" }));

    expect(onChange.mock.calls.slice(-3)).toEqual([
      ["playerSeekShortSeconds", 10],
      ["playerSeekMediumSeconds", 60],
      ["playerSeekLongSeconds", 600],
    ]);
    expect(screen.getByLabelText("seekShortInterval")).toHaveValue(10);
    expect(screen.getByLabelText("seekMediumInterval")).toHaveValue(1);
    expect(screen.getByLabelText("seekLongInterval")).toHaveValue(10);
  });
});
