# 🔍 Code Review Report

## Summary

| Metric | Value |
|--------|-------|
| **Overall Score** | 0/100 |
| **Files Reviewed** | 1 |
| **Critical Issues** | 3 |
| **High Priority Tests** | 4 |
| **Refactoring Opportunities** | 4 |

## 🎯 Top Recommendations

1. 🚨 **Security - SQL Injection**: All three new search functions (searchTodos, searchTodosByStatus, getTodosByUser) use string concatenation or template literals to build SQL queries with unsanitized user input. This creates critical SQL injection vulnerabilities allowing attackers to read unauthorized data, bypass access controls, or execute destructive commands. IMMEDIATE ACTION REQUIRED: Replace all string concatenation with parameterized queries using the $1, $2 placeholder syntax supported by the db.query method.
   - Files: src/todo.ts

2. 🚨 **Testing - Zero Coverage for Vulnerable Functions**: The three new functions added in this PR have zero test coverage despite being explicitly marked as vulnerable to SQL injection. No tests verify that SQL injection payloads are rejected or that the functions behave correctly with malicious input. This is a critical gap that must be addressed before merging.
   - Files: src/todo.ts

3. ⚠️ **Type Safety**: The searchTodosByStatus function accepts a string parameter but uses it as a boolean in SQL queries, creating type confusion and potential runtime errors. The parameter type should be changed to boolean to match the database schema and prevent invalid inputs.
   - Files: src/todo.ts

4. ⚠️ **Testing - Database Operations Untested**: All async database operations (createTodo, getAllTodos, getTodoById, updateTodoStatus, deleteTodo) lack tests verifying their database interactions, parameterized query usage, error handling, and edge cases. This represents a significant testing gap for critical application functionality.
   - Files: src/todo.ts

5. 📝 **Error Handling**: None of the three new search functions implement error handling for database failures. Errors will propagate uncaught to callers, potentially exposing internal implementation details or causing application crashes. Add try-catch blocks with sanitized error messages.
   - Files: src/todo.ts

## 📁 File Details

### 📄 `src/todo.ts`

**Quality Score:** 0/100 | **Coverage:** ~35%

#### Issues (9)
  - Line 119: `critical` SQL injection vulnerability in searchTodos function. User-controlled keyword is directly interpolated into SQL query using template literals without any sanitization or parameterization. An attacker could inject malicious SQL like `%' OR '1'='1` to extract all data or `%'; DROP TABLE todos; --` to destroy data.
  - Line 128: `critical` SQL injection vulnerability in searchTodosByStatus function. User input is concatenated directly into SQL query without validation or parameterization. An attacker could inject `1 OR 1=1` to bypass the filter or `1; DELETE FROM todos; --` to delete all todos.
  - Line 137: `critical` SQL injection vulnerability in getTodosByUser function. The userId parameter is directly embedded in a SQL query with template literals. An attacker could inject `' OR '1'='1` to access all todos from all users, or `'; DROP TABLE user_todos; --` to destroy the join table.

  *...and 6 more*

#### Test Gaps (10)
  - `searchTodos() lines 119-124` (critical priority)
  - `searchTodosByStatus() lines 129-134` (critical priority)

  *...and 8 more*

#### Refactoring Opportunities (4)
  - **simplify**: Use guard clauses with early returns instead of nested if statements to reduce cognitive complexity and improve readability
  - **modernize**: Replace method chaining with a map-based approach for better maintainability and extensibility of HTML entity replacements

  *...and 2 more*

---

*Generated at 2026-11-07T16:28:54.014Z • Duration: 303418ms*
