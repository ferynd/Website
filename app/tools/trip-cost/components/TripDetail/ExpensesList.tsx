"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React from 'react';
import { useTrip } from '../../TripContext';
import { CURRENCY_SYMBOL } from '../../constants';

export default function ExpensesList() {
  const { expenses } = useTrip();
  if (!expenses.length) return null;
  return (
    <section className="bg-white rounded shadow p-4">
      <h2 className="text-lg font-semibold mb-2">Expenses</h2>
      <table className="w-full text-left text-gray-800">
        <thead>
          <tr className="border-b">
            <th className="py-1">Category</th>
            <th className="py-1">Description</th>
            <th className="py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((e) => (
            <tr key={e.id} className="border-b last:border-b-0">
              <td className="py-1">{e.category}</td>
              <td className="py-1">{e.description}</td>
              <td className="py-1 text-right">
                {CURRENCY_SYMBOL}
                {e.totalAmount.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
