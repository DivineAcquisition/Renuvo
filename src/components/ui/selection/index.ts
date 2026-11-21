/**
 * Selestial's selection system. One look and one behaviour for every way a person chooses something:
 *
 *   Select            a short, predefined single choice
 *   SearchableSelect  one record from a long list (customers, properties, cleaners, templates)
 *   MultiSelect       several choices, with search, chips, a count and clear-all
 *   Checkbox          an acknowledgment, a simple preference, a table row
 *   CheckboxRow       a checkbox with a title and an explanation
 *   SelectionCards    an important single or multiple choice, drawn as cards
 *   RadioGroup        mutually exclusive options as rows
 *   SegmentedControl  a few short alternatives kept in view
 *   ChoiceChips       several short, independent choices as chips
 *   SwitchRow         a continuing behaviour, on or off, with when the change applies
 *   FieldSource / FieldSuggestion / Consequence / Requirement   where a value came from, what an
 *                     agent proposes and why, and what a choice will do
 *
 * Action menus (Edit, Delete) are not selections and keep Menu semantics; see clients/menu.tsx.
 * The native SelectInput in app/form.tsx stays for platform pickers and event-based handlers.
 */
export { Checkbox, CheckboxRow, tableSelection, type CheckboxProps } from "./checkbox";
export { ChoiceChips } from "./chips";
export { SelectionCard, SelectionCards } from "./cards";
export { MultiSelect, SearchableSelect } from "./combobox";
export { RadioButtonGroup, RadioGroup, SegmentedControl } from "./radio";
export { Select, type SelectProps } from "./select";
export { Consequence, Requirement, Switch, SwitchRow, type SwitchEffect } from "./switch";
export { FieldSource, FieldSuggestion, sourceWords, suggestionState, useSuggestion, type Source, type SourceKind } from "./assist";
export { useFieldControl } from "./field-context";
export type { Density } from "./tokens";
export type { ListState, Option } from "./types";
export { addressLine, agreementTypeOption, agreementTypeOptions, cleanerOption, customerOption, propertyOption, serviceOption } from "./records";
