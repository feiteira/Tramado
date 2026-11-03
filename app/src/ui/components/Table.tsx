import React, { type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cx } from '../cx';
import './table.css';

/** A scrolling table whose header stays put. Put it in a container with a height. */
export function Table({ children, className, label, dense, ...rest }: { children: ReactNode; className?: string; label?: string; dense?: boolean; 'data-testid'?: string }) {
  return (
    <div className={cx('table-wrap', className)} data-testid={rest['data-testid']}>
      <table className={cx('table', dense && 'table--dense')} aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export const THead = ({ children }: { children: ReactNode }) => <thead className="table__head">{children}</thead>;
export const TBody = ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>;

export function TR({ children, selected, className, ...rest }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; 'data-testid'?: string }) {
  return (
    <tr className={cx('table__row', selected && 'table__row--selected', className)} aria-selected={selected} {...rest}>
      {children}
    </tr>
  );
}

export type SortDir = 'asc' | 'desc' | null;

export function TH({ children, sort, onSort, numeric, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { sort?: SortDir; onSort?: () => void; numeric?: boolean }) {
  const ariaSort = sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : onSort ? 'none' : undefined;
  return (
    <th scope="col" aria-sort={ariaSort} className={cx('table__th', numeric && 'table__num', className)} {...rest}>
      {onSort ? (
        <button type="button" className="table__sort" onClick={onSort}>
          {children}
          {sort === 'asc' ? <ArrowUp size={12} aria-hidden /> : sort === 'desc' ? <ArrowDown size={12} aria-hidden /> : null}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function TD({ children, numeric, className, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td className={cx('table__td', numeric && 'table__num', className)} {...rest}>
      {children}
    </td>
  );
}
