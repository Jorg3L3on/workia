"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { chromeCopy } from "@/lib/brand/chrome-copy";
import {
  resolveBreadcrumbs,
  type BreadcrumbLabels,
} from "@/lib/navigation/breadcrumbs";

type BreadcrumbLabelsContextValue = {
  current?: string;
  setCurrent: (label: string | null) => void;
};

const BreadcrumbLabelsContext =
  createContext<BreadcrumbLabelsContextValue | null>(null);

export const BreadcrumbLabelsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [current, setCurrentState] = useState<string | undefined>(undefined);
  const setCurrent = useCallback((label: string | null) => {
    setCurrentState(label ?? undefined);
  }, []);

  const value = useMemo<BreadcrumbLabelsContextValue>(
    () => ({
      current,
      setCurrent,
    }),
    [current, setCurrent],
  );

  return (
    <BreadcrumbLabelsContext.Provider value={value}>
      {children}
    </BreadcrumbLabelsContext.Provider>
  );
};

export const PageBreadcrumbLabel = ({ label }: { label: string }) => {
  const context = useContext(BreadcrumbLabelsContext);
  const setCurrent = context?.setCurrent;

  useLayoutEffect(() => {
    if (!setCurrent) {
      return;
    }

    setCurrent(label);

    return () => {
      setCurrent(null);
    };
  }, [label, setCurrent]);

  return null;
};

export const AppBreadcrumbs = () => {
  const pathname = usePathname();
  const context = useContext(BreadcrumbLabelsContext);
  const labels: BreadcrumbLabels = { current: context?.current };
  const crumbs = resolveBreadcrumbs(pathname, labels);

  if (crumbs.length === 0) {
    return null;
  }

  return (
    <Breadcrumb aria-label={chromeCopy.breadcrumb}>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;

          return (
            <Fragment key={`${crumb.label}-${crumb.href ?? "current"}`}>
              {index > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem>
                {isLast || !crumb.href ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
};
