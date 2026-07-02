import { BulkImportPageConfig } from "./bulk-import";

/**
 * Fixture definitions for all 8 HRM bulk import pages.
 * These match the BulkImportConfig column labels used in each page component.
 * The E2E tests iterate over this array so all 8 pages are covered.
 */
export const HRM_BULK_PAGES: BulkImportPageConfig[] = [
  {
    name: "Employees",
    table: "employees",
    headers: ["Name *", "Employee Code", "Email", "Department", "Designation", "Branch"],
    validRows: [
      ["Alice Rahman", "EMP-9001", "alice@example.com", "Finance", "Manager", "Head Office"],
      ["Bob Karim", "EMP-9002", "bob@example.com", "HR", "Officer", "Head Office"],
    ],
    invalidRows: [
      { row: ["", "EMP-9003", "x@x.com", "HR", "Officer", "HO"], expectedError: /Name.*required/i },
    ],
    serverRejectRow: {
      row: ["Duplicate Code", "EMP-9001", "dup@example.com", "HR", "Officer", "HO"],
      expectedError: /Duplicate/i,
    },
  },
  {
    name: "Departments",
    table: "departments",
    headers: ["Name *", "Code", "Description"],
    validRows: [["Engineering", "ENG", "Engineering dept"], ["Sales", "SAL", "Sales team"]],
    invalidRows: [{ row: ["", "OPS", "Ops"], expectedError: /Name.*required/i }],
    serverRejectRow: { row: ["DupDept", "ENG", ""], expectedError: /matches/i },
  },
  {
    name: "Sections",
    table: "sections",
    headers: ["Name *", "Department *", "Branch"],
    validRows: [["Frontend", "Engineering", "HO"], ["Backend", "Engineering", "HO"]],
    invalidRows: [
      { row: ["", "Engineering", "HO"], expectedError: /Name.*required/i },
      { row: ["Mobile", "", "HO"], expectedError: /Department.*required/i },
    ],
  },
  {
    name: "Designations",
    table: "designations",
    headers: ["Name *", "Grade"],
    validRows: [["Senior Engineer", "L3"], ["Lead", "L4"]],
    invalidRows: [{ row: ["", "L1"], expectedError: /Name.*required/i }],
  },
  {
    name: "Shifts",
    table: "shifts",
    headers: ["Name *", "Start Time *", "End Time *"],
    validRows: [["Morning", "09:00", "17:00"], ["Evening", "17:00", "01:00"]],
    invalidRows: [
      { row: ["Night", "", "08:00"], expectedError: /Start Time.*required/i },
      { row: ["", "09:00", "17:00"], expectedError: /Name.*required/i },
    ],
  },
  {
    name: "Attendance",
    table: "attendance",
    headers: ["Employee Code *", "Date *", "Check In", "Check Out", "Status"],
    validRows: [
      ["EMP-9001", "2026-01-15", "09:05", "17:10", "present"],
      ["EMP-9002", "2026-01-15", "09:15", "17:00", "present"],
    ],
    invalidRows: [
      { row: ["", "2026-01-15", "09:00", "17:00", "present"], expectedError: /Employee Code.*required/i },
      { row: ["EMP-9001", "", "09:00", "17:00", "present"], expectedError: /Date.*required/i },
    ],
  },
  {
    name: "Overtime",
    table: "overtime_records",
    headers: ["Employee Code *", "Date *", "Hours *", "Reason"],
    validRows: [["EMP-9001", "2026-01-15", "2", "Deadline"], ["EMP-9002", "2026-01-16", "1.5", "Support"]],
    invalidRows: [
      { row: ["EMP-9001", "2026-01-15", "", ""], expectedError: /Hours.*required/i },
    ],
  },
  {
    name: "Leave",
    table: "leave_requests",
    headers: ["Employee Code *", "Leave Type *", "From Date *", "To Date *", "Reason"],
    validRows: [
      ["EMP-9001", "Casual", "2026-02-01", "2026-02-02", "Personal"],
      ["EMP-9002", "Sick", "2026-02-05", "2026-02-05", "Fever"],
    ],
    invalidRows: [
      { row: ["EMP-9001", "", "2026-02-01", "2026-02-02", ""], expectedError: /Leave Type.*required/i },
      { row: ["EMP-9001", "Casual", "", "2026-02-02", ""], expectedError: /From Date.*required/i },
    ],
  },
];
