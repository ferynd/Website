'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';

// --- Type Definitions for the Application ---
interface Person {
  id: string;
  name: string;
}

interface ManualSplitDetail {
  type: 'percent' | 'amount';
  value: number | string;
}

interface Expense {
  id: string;
  category: string;
  description: string;
  totalAmount: number;
  paidBy: { [key: string]: number };
  splitType: 'even' | 'manual';
  splitParticipants: string[];
  manualSplit: { [key: string]: ManualSplitDetail };
}

// A more flexible type for the 'new expense' form state
interface NewExpenseState {
    category: string;
    description: string;
    totalAmount: number | string;
    paidBy: { [key: string]: number | string };
    splitType: 'even' | 'manual';
    splitParticipants: string[];
    manualSplit: { [key: string]: ManualSplitDetail };
}

interface Payment {
    id: string;
    payerId: string;
    payeeId: string;
    date: string;
    description: string;
    amount: number;
}


// --- Reusable UI Components ---

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
}

/**
 * A modal for confirming actions like deletion.
 * Replaces the native window.confirm().
 */
const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, onClose, onConfirm, title, message }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-md text-gray-800">
        <h2 className="text-xl font-bold mb-3">{title}</h2>
        <p className="text-gray-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg shadow-md transition duration-300"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * A component to display validation error messages.
 * Replaces native alert().
 */
const ErrorMessage: React.FC<{ message: string }> = ({ message }) => {
  if (!message) return null;
  return (
    <div className="mt-3 p-3 bg-red-100 border border-red-300 text-red-800 rounded-md text-sm">
      {message}
    </div>
  );
};


// --- Core Application Components ---

interface PaymentInputFormProps {
    payerId: string;
    people: Person[];
    onAddPayment: (payerId: string, payeeId: string, date: string, description: string, amount: number) => void;
}

/**
 * A form for recording a direct payment between two people.
 */
const PaymentInputForm: React.FC<PaymentInputFormProps> = ({ payerId, people, onAddPayment }) => {
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [payeeId, setPayeeId] = useState('');
  const [error, setError] = useState('');

  const handleAddPayment = () => {
    if (!date || !description.trim() || !amount || parseFloat(amount) <= 0 || !payeeId) {
      setError("Please fill all fields, select a recipient, and enter a valid amount.");
      return;
    }
    setError('');
    onAddPayment(payerId, payeeId, date, description, parseFloat(amount));
    setDate('');
    setDescription('');
    setAmount('');
    setPayeeId('');
  };

  const payeeOptions = people.filter(p => p.id !== payerId);

  return (
    <div className="mt-4 p-3 bg-purple-50 rounded-md border border-purple-100">
      <h4 className="text-md font-semibold text-gray-700 mb-2">Record Payment:</h4>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-purple-400" title="Payment Date" />
        <input type="text" placeholder="Description (e.g., Venmo)" value={description} onChange={(e) => setDescription(e.target.value)} className="p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-purple-400" title="Payment Description" />
        <input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-purple-400" title="Payment Amount" />
      </div>
      <div className="mt-3">
        <label htmlFor={`payee-select-${payerId}`} className="block text-sm font-medium text-gray-700 mb-1">Pay To:</label>
        <select id={`payee-select-${payerId}`} value={payeeId} onChange={(e) => setPayeeId(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-purple-400">
          <option value="">Select recipient</option>
          {payeeOptions.map(person => (
            <option key={person.id} value={person.id}>{person.name}</option>
          ))}
        </select>
      </div>
      <ErrorMessage message={error} />
      <button onClick={handleAddPayment} className="mt-3 w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105">
        Record Payment
      </button>
    </div>
  );
};

interface EditExpenseModalProps {
    isOpen: boolean;
    onClose: () => void;
    expense: Expense;
    people: Person[];
    expenseCategories: string[];
    onSave: (expense: Expense) => void;
}

/**
 * A modal for editing an existing expense.
 */
const EditExpenseModal: React.FC<EditExpenseModalProps> = ({ isOpen, onClose, expense, people, expenseCategories, onSave }) => {
  const [editedExpense, setEditedExpense] = useState(expense);
  const [error, setError] = useState('');

  useEffect(() => {
    setEditedExpense(expense);
    setError(''); // Reset error on new expense
  }, [expense]);

  if (!isOpen) return null;

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEditedExpense(prev => ({ ...prev, [name]: value }));
  };

  const handlePaidByChange = (personId: string, value: string) => {
    setEditedExpense(prev => ({
      ...prev,
      paidBy: { ...prev.paidBy, [personId]: value === '' ? 0 : parseFloat(value) || 0 },
    }));
  };

  const handleSplitParticipantToggle = (personId: string) => {
    setEditedExpense(prev => {
      const updatedParticipants = prev.splitParticipants.includes(personId)
        ? prev.splitParticipants.filter(id => id !== personId)
        : [...prev.splitParticipants, personId];
      return { ...prev, splitParticipants: updatedParticipants };
    });
  };

  const handleManualSplitTypeChange = (personId: string, type: 'percent' | 'amount') => {
    setEditedExpense(prev => ({
      ...prev,
      manualSplit: { ...prev.manualSplit, [personId]: { ...prev.manualSplit[personId], type: type, value: '' } },
    }));
  };

  const handleManualSplitValueChange = (personId: string, value: string) => {
    setEditedExpense(prev => ({
      ...prev,
      manualSplit: { ...prev.manualSplit, [personId]: { ...prev.manualSplit[personId], value: value === '' ? '' : parseFloat(value) || 0 } },
    }));
  };

  const handleSave = () => {
    const totalAmount = parseFloat(String(editedExpense.totalAmount));
    if (isNaN(totalAmount) || totalAmount <= 0 || editedExpense.description.trim() === '') {
      setError("Please enter a valid amount and description.");
      return;
    }

    const paidByTotal = Object.values(editedExpense.paidBy).reduce((sum: number, val) => sum + (parseFloat(String(val)) || 0), 0);
    if (Math.abs(paidByTotal - totalAmount) > 0.01) {
      setError("Total paid by individuals does not match the total expense amount.");
      return;
    }

    if (editedExpense.splitType === 'manual') {
      const manualSplitSum = Object.entries(editedExpense.manualSplit).reduce((sum: number, [personId, details]) => {
        if (!editedExpense.splitParticipants.includes(personId)) return sum;
        return sum + (parseFloat(String(details.value)) || 0);
      }, 0);

      if (editedExpense.splitParticipants.length > 0) {
        const firstParticipantSplitType = editedExpense.manualSplit[editedExpense.splitParticipants[0]]?.type;
        if (firstParticipantSplitType === 'percent' && Math.abs(manualSplitSum - 100) > 0.01) {
          setError("Manual split percentages must sum to 100%.");
          return;
        } else if (firstParticipantSplitType === 'amount' && Math.abs(manualSplitSum - totalAmount) > 0.01) {
          setError("Manual split amounts must sum to the total expense amount.");
          return;
        }
      }
    }
    setError('');
    onSave(editedExpense);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto text-gray-800">
        <h2 className="text-2xl font-bold text-blue-700 mb-4">Edit Expense</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
             <label htmlFor="edit-category" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
             <select id="edit-category" name="category" value={editedExpense.category} onChange={handleEditChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400">
               {expenseCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
             </select>
           </div>
           <div>
             <label htmlFor="edit-description" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
             <input type="text" id="edit-description" name="description" value={editedExpense.description} onChange={handleEditChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400" />
           </div>
           <div className="md:col-span-2">
             <label htmlFor="edit-totalAmount" className="block text-sm font-medium text-gray-700 mb-1">Total Amount ($)</label>
             <input type="number" id="edit-totalAmount" name="totalAmount" value={editedExpense.totalAmount} onChange={handleEditChange} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400" />
           </div>
         </div>
         <div className="mb-4">
           <h3 className="text-lg font-semibold text-gray-700 mb-2">Paid By:</h3>
           <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
             {people.map(person => (
               <div key={person.id} className="flex flex-col">
                 <label className="text-sm text-gray-600 mb-1">{person.name}</label>
                 <input type="number" placeholder="0.00" value={editedExpense.paidBy[person.id] || ''} onChange={(e) => handlePaidByChange(person.id, e.target.value)} className="w-full p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-400" />
               </div>
             ))}
           </div>
         </div>
        <div className="mb-6">
           <h3 className="text-lg font-semibold text-gray-700 mb-2">Split Options:</h3>
           <div className="flex items-center space-x-4 mb-4">
             <label className="flex items-center cursor-pointer">
               <input type="radio" name="splitType" value="even" checked={editedExpense.splitType === 'even'} onChange={handleEditChange} className="form-radio h-5 w-5 text-blue-600" />
               <span className="ml-2 text-gray-700">Even Split</span>
             </label>
             <label className="flex items-center cursor-pointer">
               <input type="radio" name="splitType" value="manual" checked={editedExpense.splitType === 'manual'} onChange={handleEditChange} className="form-radio h-5 w-5 text-blue-600" />
               <span className="ml-2 text-gray-700">Manual Split</span>
             </label>
           </div>
           {editedExpense.splitType === 'even' && (
             <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
               {people.map(person => (
                 <label key={person.id} className="flex items-center cursor-pointer bg-gray-50 p-3 rounded-md shadow-sm">
                   <input type="checkbox" checked={editedExpense.splitParticipants.includes(person.id)} onChange={() => handleSplitParticipantToggle(person.id)} className="form-checkbox h-5 w-5 text-blue-600 rounded" />
                   <span className="ml-2 text-gray-700 font-medium">{person.name}</span>
                 </label>
               ))}
             </div>
           )}
           {editedExpense.splitType === 'manual' && (
             <div className="space-y-4">
               {people.map(person => (
                 <div key={person.id} className="flex items-center gap-4 bg-gray-50 p-4 rounded-md shadow-sm">
                   <span className="font-medium w-24 text-gray-700">{person.name}:</span>
                   <div className="flex items-center gap-2">
                     <label className="flex items-center cursor-pointer">
                       <input type="radio" name={`manual-split-type-${person.id}`} value="percent" checked={editedExpense.manualSplit[person.id]?.type === 'percent'} onChange={() => handleManualSplitTypeChange(person.id, 'percent')} className="form-radio h-4 w-4 text-blue-600" />
                       <span className="ml-1 text-sm text-gray-600">%</span>
                     </label>
                     <label className="flex items-center cursor-pointer">
                       <input type="radio" name={`manual-split-type-${person.id}`} value="amount" checked={editedExpense.manualSplit[person.id]?.type === 'amount'} onChange={() => handleManualSplitTypeChange(person.id, 'amount')} className="form-radio h-4 w-4 text-blue-600" />
                       <span className="ml-1 text-sm text-gray-600">$</span>
                     </label>
                   </div>
                   <input type="number" placeholder="Value" value={editedExpense.manualSplit[person.id]?.value || ''} onChange={(e) => handleManualSplitValueChange(person.id, e.target.value)} className="flex-grow p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-400" />
                 </div>
               ))}
             </div>
           )}
         </div>
        <ErrorMessage message={error} />
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-lg shadow-md transition duration-300">
            Cancel
          </button>
          <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};


/**
 * The main application component, now serving as the page.
 */
const TripCostPage = () => {
  // --- Configuration ---
  const expenseCategories = useMemo(() => ['Meals', 'Flights', 'Accommodation', 'Activities', 'Transport', 'Other'], []);

  // --- State Management ---
  const [people, setPeople] = useState<Person[]>([{ id: 'person-1', name: 'Person 1' }, { id: 'person-2', name: 'Person 2' }]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [allPayments, setAllPayments] = useState<Payment[]>([]);
  
  const [newPersonName, setNewPersonName] = useState('');
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  
  const [isEditExpenseModalOpen, setIsEditExpenseModalOpen] = useState(false);
  const [currentEditingExpense, setCurrentEditingExpense] = useState<Expense | null>(null);

  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editedPaymentData, setEditedPaymentData] = useState<Partial<Payment>>({});
  
  const [addExpenseError, setAddExpenseError] = useState('');

  // Confirmation Modal State
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [confirmModalProps, setConfirmModalProps] = useState({ title: '', message: '' });

  // --- Helper Functions ---
  const createInitialExpenseState = useCallback((currentPeople: Person[]): NewExpenseState => ({
    category: expenseCategories[0],
    description: '',
    totalAmount: '',
    paidBy: currentPeople.reduce((acc, person) => ({ ...acc, [person.id]: '' }), {}),
    splitType: 'even',
    splitParticipants: currentPeople.map(person => person.id),
    manualSplit: currentPeople.reduce((acc, person) => ({ ...acc, [person.id]: { type: 'percent', value: '' } }), {}),
  }), [expenseCategories]);

  const [newExpense, setNewExpense] = useState<NewExpenseState>(() => createInitialExpenseState(people));

  useEffect(() => {
      setNewExpense(createInitialExpenseState(people));
  }, [people, createInitialExpenseState]);

  // --- Confirmation Modal Logic ---
  const openConfirmationModal = (onConfirm: () => void, title: string, message: string) => {
    setConfirmModalProps({ title, message });
    setConfirmAction(() => onConfirm); // Store the function to be executed
    setIsConfirmModalOpen(true);
  };

  const handleConfirm = () => {
    if (confirmAction) {
      confirmAction();
    }
    setIsConfirmModalOpen(false);
    setConfirmAction(null);
  };

  // --- Person Management ---
  const addPerson = () => {
    if (newPersonName.trim() === '') return;
    const newPerson = { id: crypto.randomUUID(), name: newPersonName.trim() };
    const updatedPeople = [...people, newPerson];
    setPeople(updatedPeople);
    setNewPersonName('');
  };

  const removePerson = (personIdToRemove: string) => {
    const onConfirm = () => {
      const updatedPeople = people.filter(p => p.id !== personIdToRemove);
      setPeople(updatedPeople);
      setExpenses(prev => prev.filter(exp => !Object.keys(exp.paidBy).includes(personIdToRemove)));
      setAllPayments(prev => prev.filter(p => p.payerId !== personIdToRemove && p.payeeId !== personIdToRemove));
    };
    openConfirmationModal(onConfirm, "Delete Participant?", `Are you sure you want to remove this person? All their associated expenses and payments will be deleted.`);
  };

  const handlePersonNameChange = (personId: string, newName: string) => {
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, name: newName } : p));
  };
  
  // --- New Expense Form Handlers ---
  const handleNewExpenseChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setNewExpense(prev => ({ ...prev, [e.target.name]: e.target.value }));
  const handlePaidByChange = (personId: string, value: string) => setNewExpense(prev => ({ ...prev, paidBy: { ...prev.paidBy, [personId]: value === '' ? '' : parseFloat(value) || 0 } }));
  const handleSplitParticipantToggle = (personId: string) => {
    setNewExpense(prev => {
      const updated = prev.splitParticipants.includes(personId) ? prev.splitParticipants.filter(id => id !== personId) : [...prev.splitParticipants, personId];
      return { ...prev, splitParticipants: updated };
    });
  };
  const handleManualSplitTypeChange = (personId: string, type: 'percent' | 'amount') => setNewExpense(prev => ({ ...prev, manualSplit: { ...prev.manualSplit, [personId]: { ...prev.manualSplit[personId], type, value: '' } } }));
  const handleManualSplitValueChange = (personId: string, value: string) => setNewExpense(prev => ({ ...prev, manualSplit: { ...prev.manualSplit, [personId]: { ...prev.manualSplit[personId], value: value === '' ? '' : parseFloat(value) || 0 } } }));

  // --- Expense CRUD ---
  const addExpense = useCallback(() => {
    const totalAmount = parseFloat(String(newExpense.totalAmount));
    if (isNaN(totalAmount) || totalAmount <= 0 || newExpense.description.trim() === '') {
      setAddExpenseError("Please enter a valid amount and description.");
      return;
    }

    const paidByTotal = Object.values(newExpense.paidBy).reduce((sum: number, val) => sum + (parseFloat(String(val)) || 0), 0);
    if (Math.abs(paidByTotal - totalAmount) > 0.01) {
      setAddExpenseError("Total paid by individuals does not match the total expense amount.");
      return;
    }

    if (newExpense.splitType === 'manual') {
        const manualSplitSum = Object.entries(newExpense.manualSplit).reduce((sum: number, [personId, details]) => {
            if (!newExpense.splitParticipants.includes(personId)) return sum;
            return sum + (parseFloat(String(details.value)) || 0);
        }, 0);

        if (newExpense.splitParticipants.length > 0) {
            const firstParticipantSplitType = newExpense.manualSplit[newExpense.splitParticipants[0]]?.type;
            if (firstParticipantSplitType === 'percent' && Math.abs(manualSplitSum - 100) > 0.01) {
                setAddExpenseError("Manual split percentages must sum to 100%.");
                return;
            } else if (firstParticipantSplitType === 'amount' && Math.abs(manualSplitSum - totalAmount) > 0.01) {
                setAddExpenseError("Manual split amounts must sum to the total expense amount.");
                return;
            }
        }
    }

    setAddExpenseError('');
    
    const finalPaidBy: { [key: string]: number } = {};
    for (const key in newExpense.paidBy) {
        finalPaidBy[key] = parseFloat(String(newExpense.paidBy[key])) || 0;
    }

    const finalExpense: Expense = {
        id: crypto.randomUUID(),
        category: newExpense.category,
        description: newExpense.description,
        totalAmount: totalAmount,
        paidBy: finalPaidBy,
        splitType: newExpense.splitType,
        splitParticipants: newExpense.splitParticipants,
        manualSplit: newExpense.manualSplit
    };
    setExpenses(prev => [...prev, finalExpense]);
  }, [newExpense, createInitialExpenseState]);

  const deleteExpense = useCallback((expenseIdToDelete: string) => {
    const onConfirm = () => {
        setExpenses(prev => prev.filter(e => e.id !== expenseIdToDelete));
    };
    openConfirmationModal(onConfirm, "Delete Expense?", "Are you sure you want to permanently delete this expense?");
  }, []);

  const openEditExpenseModal = useCallback((expense: Expense) => {
    setCurrentEditingExpense(expense);
    setIsEditExpenseModalOpen(true);
  }, []);

  const saveEditedExpense = useCallback((updatedExpense: Expense) => {
    setExpenses(prev => prev.map(e => e.id === updatedExpense.id ? updatedExpense : e));
    setIsEditExpenseModalOpen(false);
    setCurrentEditingExpense(null);
  }, []);

  // --- Payment CRUD ---
  const addPayment = useCallback((payerId: string, payeeId: string, date: string, description: string, amount: number) => {
    setAllPayments(prev => [...prev, { id: crypto.randomUUID(), payerId, payeeId, date, description, amount }]);
  }, []);

  const deletePayment = useCallback((paymentIdToDelete: string) => {
    const onConfirm = () => {
        setAllPayments(prev => prev.filter(p => p.id !== paymentIdToDelete));
    };
    openConfirmationModal(onConfirm, "Delete Payment?", "Are you sure you want to permanently delete this payment record?");
  }, []);

  const startEditingPayment = useCallback((payment: Payment) => {
    setEditingPaymentId(payment.id);
    setEditedPaymentData({ ...payment });
  }, []);

  const handleEditedPaymentChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setEditedPaymentData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }, []);

  const saveEditedPayment = useCallback(() => {
    if (!editedPaymentData.date || !editedPaymentData.description?.trim() || !editedPaymentData.amount || parseFloat(String(editedPaymentData.amount)) <= 0 || !editedPaymentData.payeeId) {
      return;
    }
    const finalPayment: Payment = {
        id: editedPaymentData.id!,
        payerId: editedPaymentData.payerId!,
        payeeId: editedPaymentData.payeeId!,
        date: editedPaymentData.date,
        description: editedPaymentData.description,
        amount: parseFloat(String(editedPaymentData.amount))
    };
    setAllPayments(prev => prev.map(p => p.id === finalPayment.id ? finalPayment : p));
    setEditingPaymentId(null);
    setEditedPaymentData({});
  }, [editedPaymentData]);

  const cancelEditingPayment = useCallback(() => {
    setEditingPaymentId(null);
    setEditedPaymentData({});
  }, []);

  // --- Calculation Logic ---
  const calculateShouldHavePaid = useCallback((expense: Expense) => {
    const shouldPay: { [key: string]: number } = {};
    const totalAmount = expense.totalAmount;
    const includedParticipants = expense.splitParticipants;

    if (expense.splitType === 'even') {
      const numParticipants = includedParticipants.length;
      const amountPerPerson = numParticipants > 0 ? totalAmount / numParticipants : 0;
      people.forEach(person => {
        shouldPay[person.id] = includedParticipants.includes(person.id) ? amountPerPerson : 0;
      });
    } else { // manual split
      people.forEach(person => {
        if (includedParticipants.includes(person.id) && expense.manualSplit[person.id]) {
          const detail = expense.manualSplit[person.id];
          shouldPay[person.id] = detail.type === 'percent' ? (totalAmount * (parseFloat(String(detail.value)) || 0)) / 100 : parseFloat(String(detail.value)) || 0;
        } else {
          shouldPay[person.id] = 0;
        }
      });
    }
    return shouldPay;
  }, [people]);

  const calculateNetBalances = useCallback(() => {
    const balances = people.reduce((acc, person) => {
        acc[person.id] = 0;
        return acc;
    }, {} as { [key: string]: number });
    
    expenses.forEach(expense => {
      const shouldPay = calculateShouldHavePaid(expense);
      people.forEach(person => {
        balances[person.id] -= shouldPay[person.id];
        balances[person.id] += (expense.paidBy[person.id] || 0);
      });
    });

    allPayments.forEach(payment => {
      if(balances[payment.payerId] !== undefined) {
          balances[payment.payerId] += payment.amount;
      }
      if(balances[payment.payeeId] !== undefined) {
          balances[payment.payeeId] -= payment.amount;
      }
    });

    return balances;
  }, [expenses, people, allPayments, calculateShouldHavePaid]);

  const calculateTableTotals = useCallback(() => {
    const categorySubtotals: { [key: string]: { [key: string]: { paid: number, shouldPay: number } } } = {};
    const grandTotals = people.reduce((acc, p) => ({ ...acc, [p.id]: { paid: 0, shouldPay: 0 } }), {} as { [key: string]: { paid: number, shouldPay: number } });
    
    expenseCategories.forEach(category => {
      categorySubtotals[category] = people.reduce((acc, p) => ({ ...acc, [p.id]: { paid: 0, shouldPay: 0 } }), {} as { [key: string]: { paid: number, shouldPay: number } });
      const expensesInCategory = expenses.filter(exp => exp.category === category);
      expensesInCategory.forEach(expense => {
        const shouldPay = calculateShouldHavePaid(expense);
        people.forEach(person => {
          const paid = expense.paidBy[person.id] || 0;
          const should = shouldPay[person.id] || 0;
          categorySubtotals[category][person.id].paid += paid;
          categorySubtotals[category][person.id].shouldPay += should;
          grandTotals[person.id].paid += paid;
          grandTotals[person.id].shouldPay += should;
        });
      });
    });
    return { categorySubtotals, grandTotals };
  }, [expenses, people, expenseCategories, calculateShouldHavePaid]);

  const netBalances = calculateNetBalances();
  const { categorySubtotals, grandTotals } = calculateTableTotals();
  
  // --- Render ---
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-100 p-4 font-sans text-gray-800">
      <div className="max-w-7xl mx-auto bg-white rounded-xl shadow-lg p-8 space-y-8">
        <h1 className="text-4xl font-extrabold text-center text-blue-700 mb-8">Trip Cost Tracker</h1>

        {/* People Management Section */}
        <div className="bg-blue-50 p-6 rounded-lg shadow-inner">
          <h2 className="text-2xl font-bold text-blue-600 mb-4">Participants</h2>
          <div className="flex flex-wrap gap-4 mb-4 items-center">
            {people.map(person => (
              <div key={person.id} className="flex items-center bg-blue-200 text-blue-800 px-4 py-2 rounded-full font-medium shadow-sm">
                {editingPersonId === person.id ? (
                  <input type="text" value={person.name} onChange={(e) => handlePersonNameChange(person.id, e.target.value)} onBlur={() => setEditingPersonId(null)} onKeyDown={(e) => e.key === 'Enter' && setEditingPersonId(null)} className="bg-blue-100 text-blue-800 rounded-full font-medium focus:outline-none focus:ring-1 focus:ring-blue-400" autoFocus />
                ) : (
                  <span className="cursor-pointer" onClick={() => setEditingPersonId(person.id)}>{person.name}</span>
                )}
                <button onClick={() => removePerson(person.id)} className="ml-2 text-red-500 hover:text-red-700 font-bold text-lg leading-none" title="Remove Person">&times;</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input type="text" placeholder="Add new person name" value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)} className="flex-grow p-3 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-transparent transition duration-200" />
            <button onClick={addPerson} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105">Add Person</button>
          </div>
        </div>

        {/* Add New Expense Section */}
        <div className="bg-green-50 p-6 rounded-lg shadow-inner">
           <h2 className="text-2xl font-bold text-green-600 mb-4">Add New Expense</h2>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
             <div>
               <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
               <select id="category" name="category" value={newExpense.category} onChange={handleNewExpenseChange} className="w-full p-3 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-400 focus:border-transparent transition duration-200">
                 {expenseCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
               </select>
             </div>
             <div>
               <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
               <input type="text" id="description" name="description" placeholder="e.g., Dinner at Italian Place" value={newExpense.description} onChange={handleNewExpenseChange} className="w-full p-3 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-400 focus:border-transparent transition duration-200" />
             </div>
             <div className="md:col-span-2">
               <label htmlFor="totalAmount" className="block text-sm font-medium text-gray-700 mb-1">Total Amount ($)</label>
               <input type="number" id="totalAmount" name="totalAmount" placeholder="e.g., 120.50" value={String(newExpense.totalAmount)} onChange={handleNewExpenseChange} className="w-full p-3 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-400 focus:border-transparent transition duration-200" />
             </div>
           </div>
           <div className="mb-4">
             <h3 className="text-lg font-semibold text-gray-700 mb-2">Paid By:</h3>
             <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
               {people.map(person => (
                 <div key={person.id} className="flex flex-col">
                   <label htmlFor={`paid-by-${person.id}`} className="text-sm text-gray-600 mb-1">{person.name}</label>
                   <input type="number" id={`paid-by-${person.id}`} placeholder="0.00" value={String(newExpense.paidBy[person.id])} onChange={(e) => handlePaidByChange(person.id, e.target.value)} className="w-full p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-green-400 transition duration-200" />
                 </div>
               ))}
             </div>
           </div>
           <div className="mb-6">
             <h3 className="text-lg font-semibold text-gray-700 mb-2">Split Options:</h3>
             <div className="flex items-center space-x-4 mb-4">
               <label className="flex items-center cursor-pointer">
                 <input type="radio" name="splitType" value="even" checked={newExpense.splitType === 'even'} onChange={handleNewExpenseChange} className="form-radio h-5 w-5 text-green-600" />
                 <span className="ml-2 text-gray-700">Even Split</span>
               </label>
               <label className="flex items-center cursor-pointer">
                 <input type="radio" name="splitType" value="manual" checked={newExpense.splitType === 'manual'} onChange={handleNewExpenseChange} className="form-radio h-5 w-5 text-green-600" />
                 <span className="ml-2 text-gray-700">Manual Split</span>
               </label>
             </div>
             {newExpense.splitType === 'even' && (
               <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                 {people.map(person => (
                   <label key={person.id} className="flex items-center cursor-pointer bg-white p-3 rounded-md shadow-sm hover:shadow-md transition duration-200">
                     <input type="checkbox" checked={newExpense.splitParticipants.includes(person.id)} onChange={() => handleSplitParticipantToggle(person.id)} className="form-checkbox h-5 w-5 text-green-600 rounded" />
                     <span className="ml-2 text-gray-700 font-medium">{person.name}</span>
                   </label>
                 ))}
               </div>
             )}
             {newExpense.splitType === 'manual' && (
               <div className="space-y-4">
                 {people.map(person => (
                   <div key={person.id} className="flex items-center gap-4 bg-white p-4 rounded-md shadow-sm">
                     <span className="font-medium w-24 text-gray-700">{person.name}:</span>
                     <div className="flex items-center gap-2">
                       <label className="flex items-center cursor-pointer">
                         <input type="radio" name={`manual-split-type-${person.id}`} value="percent" checked={newExpense.manualSplit[person.id]?.type === 'percent'} onChange={() => handleManualSplitTypeChange(person.id, 'percent')} className="form-radio h-4 w-4 text-green-600" />
                         <span className="ml-1 text-sm text-gray-600">%</span>
                       </label>
                       <label className="flex items-center cursor-pointer">
                         <input type="radio" name={`manual-split-type-${person.id}`} value="amount" checked={newExpense.manualSplit[person.id]?.type === 'amount'} onChange={() => handleManualSplitTypeChange(person.id, 'amount')} className="form-radio h-4 w-4 text-green-600" />
                         <span className="ml-1 text-sm text-gray-600">$</span>
                       </label>
                     </div>
                     <input type="number" placeholder="Value" value={String(newExpense.manualSplit[person.id]?.value)} onChange={(e) => handleManualSplitValueChange(person.id, e.target.value)} className="flex-grow p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-green-400 transition duration-200" />
                   </div>
                 ))}
               </div>
             )}
           </div>
           <ErrorMessage message={addExpenseError} />
           <button onClick={addExpense} className="w-full mt-3 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105">
             Add Expense
           </button>
        </div>

        {/* Expense List Section */}
        {expenses.length > 0 && (
          <div className="bg-gray-50 p-6 rounded-lg shadow-inner overflow-x-auto">
            <h2 className="text-2xl font-bold text-blue-700 mb-4">Expense Details</h2>
            <table className="min-w-full bg-white rounded-lg shadow-md border border-gray-200 table-fixed">
              <thead>
                <tr className="bg-blue-100 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                  <th rowSpan={2} className="py-3 px-4 border-b border-gray-200">Category</th>
                  <th rowSpan={2} className="py-3 px-4 border-b border-gray-200">Description</th>
                  <th rowSpan={2} className="py-3 px-4 border-b border-r border-gray-300 text-right w-32">Total</th>
                  {people.map(person => <th key={person.id} colSpan={2} className="py-3 px-4 border-b border-r border-gray-300 text-center">{person.name}</th>)}
                  <th rowSpan={2} className="py-3 px-4 border-b border-gray-200">Actions</th>
                </tr>
                <tr className="bg-blue-50 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                  {people.map(person => (
                    <React.Fragment key={`${person.id}-subheaders`}>
                      <th className="py-2 px-2 text-right border-b border-gray-200 w-32">Paid</th>
                      <th className="py-2 px-2 text-right border-b border-r border-gray-300 w-32">Owes</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {expenseCategories.map(category => {
                  const expensesInCategory = expenses.filter(exp => exp.category === category);
                  if (expensesInCategory.length === 0) return null;
                  return (
                    <React.Fragment key={category}>
                      <tr className="bg-blue-100"><td colSpan={4 + people.length * 2} className="py-2 px-4 font-bold text-blue-800">{category}</td></tr>
                      {expensesInCategory.map(expense => {
                        const shouldPay = calculateShouldHavePaid(expense);
                        return (
                          <tr key={expense.id} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-2 px-4 text-sm text-gray-800">{expense.category}</td>
                            <td className="py-2 px-4 text-sm text-gray-800">{expense.description}</td>
                            <td className="py-2 px-4 text-sm text-gray-800 text-right border-r border-gray-300 w-32">${expense.totalAmount.toFixed(2)}</td>
                            {people.map(person => (
                              <React.Fragment key={`${expense.id}-${person.id}-data`}>
                                <td className="py-2 px-2 text-sm text-gray-700 text-right w-32">${(expense.paidBy[person.id] || 0).toFixed(2)}</td>
                                <td className="py-2 px-2 text-sm text-gray-700 text-right border-r border-gray-300 w-32">${(shouldPay[person.id] || 0).toFixed(2)}</td>
                              </React.Fragment>
                            ))}
                            <td className="py-2 px-4 text-sm text-gray-800 flex items-center justify-center space-x-2">
                              <button onClick={() => openEditExpenseModal(expense)} className="text-blue-500 hover:text-blue-700" title="Edit Expense">&#9998;</button>
                              <button onClick={() => deleteExpense(expense.id)} className="text-red-500 hover:text-red-700" title="Delete Expense">&times;</button>
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="bg-gray-200 font-semibold">
                        <td colSpan={2} className="py-2 px-4 text-right text-gray-800">Subtotal:</td>
                        <td className="py-2 px-4 text-right border-r border-gray-300 w-32">${expensesInCategory.reduce((s, e) => s + e.totalAmount, 0).toFixed(2)}</td>
                        {people.map(person => (
                          <React.Fragment key={`${category}-${person.id}-subtotal`}>
                            <td className="py-2 px-2 text-right w-32">${(categorySubtotals[category][person.id].paid).toFixed(2)}</td>
                            <td className="py-2 px-2 text-right border-r border-gray-300 w-32">${(categorySubtotals[category][person.id].shouldPay).toFixed(2)}</td>
                          </React.Fragment>
                        ))}
                        <td className="py-2 px-4"></td>
                      </tr>
                    </React.Fragment>
                  );
                })}
                <tr className="bg-blue-600 font-bold text-lg text-white">
                  <td colSpan={2} className="py-3 px-4 text-right">Grand Total:</td>
                  <td className="py-3 px-4 text-right border-r border-blue-700 w-32">${expenses.reduce((s, e) => s + e.totalAmount, 0).toFixed(2)}</td>
                  {people.map(person => (
                    <React.Fragment key={`${person.id}-grandtotal`}>
                      <td className="py-3 px-2 text-right w-32">${(grandTotals[person.id].paid).toFixed(2)}</td>
                      <td className="py-3 px-2 text-right border-r border-blue-700 w-32">${(grandTotals[person.id].shouldPay).toFixed(2)}</td>
                    </React.Fragment>
                  ))}
                  <td className="py-3 px-4"></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Summary Section */}
        {expenses.length > 0 && (
          <div className="bg-purple-50 p-6 rounded-lg shadow-inner">
            <h2 className="text-2xl font-bold text-purple-700 mb-4">Summary: Who Owes Who</h2>
            <div className="space-y-6">
              {people.map(person => {
                const balance = netBalances[person.id] || 0;
                const payments = allPayments.filter(p => p.payeeId === person.id || p.payerId === person.id);
                return (
                  <div key={person.id} className="bg-white p-4 rounded-lg shadow-md border border-purple-200">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-lg font-semibold text-gray-800">{person.name}:</span>
                      <span className={`text-xl font-bold ${balance < -0.01 ? 'text-red-600' : 'text-green-600'}`}>
                        {balance < -0.01 ? `Owes $${Math.abs(balance).toFixed(2)}` : `Is Owed $${balance.toFixed(2)}`}
                      </span>
                    </div>
                    <PaymentInputForm payerId={person.id} people={people} onAddPayment={addPayment} />
                    {payments.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-purple-100">
                        <h4 className="text-md font-semibold text-gray-700 mb-2">Payment History:</h4>
                        <ul className="space-y-2">
                          {payments.map(payment => (
                            <li key={payment.id} className="text-sm text-gray-600 bg-purple-50 p-2 rounded-md flex justify-between items-center">
                              {editingPaymentId === payment.id ? (
                                <div className="flex flex-col w-full gap-2">
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                    <input type="date" name="date" value={editedPaymentData.date || ''} onChange={handleEditedPaymentChange} className="p-1 border border-gray-300 rounded-md"/>
                                    <input type="text" name="description" placeholder="Description" value={editedPaymentData.description || ''} onChange={handleEditedPaymentChange} className="p-1 border border-gray-300 rounded-md"/>
                                    <input type="number" name="amount" placeholder="Amount" value={String(editedPaymentData.amount) || ''} onChange={handleEditedPaymentChange} className="p-1 border border-gray-300 rounded-md"/>
                                  </div>
                                  <select name="payeeId" value={editedPaymentData.payeeId || ''} onChange={handleEditedPaymentChange} className="w-full p-1 border border-gray-300 rounded-md">
                                      <option value="">Select recipient</option>
                                      {people.filter(p => p.id !== payment.payerId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                  </select>
                                  <div className="flex justify-end gap-2 mt-2">
                                      <button onClick={cancelEditingPayment} className="text-gray-500 hover:text-gray-700 text-xs">Cancel</button>
                                      <button onClick={saveEditedPayment} className="text-blue-500 hover:text-blue-700 text-xs">Save</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <span>
                                    {payment.date} | 
                                    {payment.payerId === person.id ? ` Paid to: ${people.find(p => p.id === payment.payeeId)?.name}` : ` Received from: ${people.find(p => p.id === payment.payerId)?.name}`}
                                    | {payment.description} | <span className="font-medium">${payment.amount.toFixed(2)}</span>
                                  </span>
                                  <div className="flex items-center space-x-2">
                                    <button onClick={() => startEditingPayment(payment)} className="text-blue-500 hover:text-blue-700" title="Edit Payment">&#9998;</button>
                                    <button onClick={() => deletePayment(payment.id)} className="text-red-500 hover:text-red-700" title="Delete Payment">&times;</button>
                                  </div>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      
      {/* Global Modals */}
      <ConfirmationModal 
        isOpen={isConfirmModalOpen} 
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={handleConfirm}
        title={confirmModalProps.title}
        message={confirmModalProps.message}
      />
      {currentEditingExpense && (
        <EditExpenseModal
          isOpen={isEditExpenseModalOpen}
          onClose={() => setIsEditExpenseModalOpen(false)}
          expense={currentEditingExpense}
          people={people}
          expenseCategories={expenseCategories}
          onSave={saveEditedExpense}
        />
      )}
    </div>
  );
};

export default TripCostPage;
