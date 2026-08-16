import { useCallback, useMemo, useState } from "react";

import { getBrowserAccounts, getBrands } from "../api/accounts.api";

import type { BrowserAccount, BrandOption } from "../types";

export function useBrowserAccounts({
  requestedAccountId,
}: {
  requestedAccountId?: string | null;
}) {
  const [accounts, setAccounts] = useState<BrowserAccount[]>([]);

  const [brands, setBrands] = useState<BrandOption[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const loadBrands = useCallback(async () => {
    try {
      const result = await getBrands();

      setBrands(result as BrandOption[]);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to load brands.",
      );
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    setLoading(true);

    setError("");

    try {
      const result = await getBrowserAccounts();

      const nextAccounts = result as BrowserAccount[];

      setAccounts(nextAccounts);

      setSelectedId((current) => {
        const requested =
          requestedAccountId &&
          nextAccounts.some((account) => account.id === requestedAccountId)
            ? requestedAccountId
            : null;

        const exists =
          current && nextAccounts.some((account) => account.id === current);

        return (
          requested || (exists ? current : null) || nextAccounts[0]?.id || null
        );
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to load accounts.",
      );
    } finally {
      setLoading(false);
    }
  }, [requestedAccountId]);

  const refresh = useCallback(async () => {
    await Promise.all([loadAccounts(), loadBrands()]);
  }, [loadAccounts, loadBrands]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedId) || null,
    [accounts, selectedId],
  );

  return {
    accounts,
    brands,
    selectedId,
    selectedAccount,

    loading,
    error,

    setSelectedId,

    loadAccounts,
    loadBrands,
    refresh,
  };
}
