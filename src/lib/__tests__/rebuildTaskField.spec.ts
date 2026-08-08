import { extractTaskFromApiHistory } from "../rebuildTaskField.js"

describe("extractTaskFromApiHistory", () => {
    it("returns null for null input", () => {
        expect(extractTaskFromApiHistory(null as unknown as unknown[])).toBeNull()
    })

    it("returns null for non-array input", () => {
        expect(extractTaskFromApiHistory("not array" as unknown as unknown[])).toBeNull()
    })

    it("returns null for empty array", () => {
        expect(extractTaskFromApiHistory([])).toBeNull()
    })

    it("returns null when no user turn exists", () => {
        expect(
            extractTaskFromApiHistory([
                { role: "assistant", content: [{ type: "text", text: "Hi" }] },
            ]),
        ).toBeNull()
    })

    it("returns null when user turn has no <user_message> tag", () => {
        expect(
            extractTaskFromApiHistory([
                {
                    role: "user",
                    content: [{ type: "text", text: "Just a plain message" }],
                },
            ]),
        ).toBeNull()
    })

    it("extracts task from <user_message> tag in single text block", () => {
        const result = extractTaskFromApiHistory([
            {
                role: "user",
                content: [
                    { type: "text", text: "<user_message>Fix the login bug</user_message>" },
                ],
            },
        ])
        expect(result).toBe("Fix the login bug")
    })

    it("trims whitespace from extracted task", () => {
        const result = extractTaskFromApiHistory([
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "<user_message>\n  Refactor auth  \n</user_message>",
                    },
                ],
            },
        ])
        expect(result).toBe("Refactor auth")
    })

    it("concatenates multiple text blocks for split tags", () => {
        const result = extractTaskFromApiHistory([
            {
                role: "user",
                content: [
                    { type: "text", text: "Prefix\n<user_message>" },
                    { type: "text", text: "Task part 1\nTask part 2" },
                    { type: "text", text: "</user_message>\nSuffix" },
                ],
            },
        ])
        expect(result).toBe("Task part 1\nTask part 2")
    })

    it("only checks the first user turn", () => {
        const result = extractTaskFromApiHistory([
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "<user_message>First task</user_message>",
                    },
                ],
            },
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "<user_message>Second task</user_message>",
                    },
                ],
            },
        ])
        expect(result).toBe("First task")
    })

    it("skips non-object turns gracefully", () => {
        const result = extractTaskFromApiHistory([
            null,
            "string turn",
            {
                role: "user",
                content: [
                    { type: "text", text: "<user_message>Valid</user_message>" },
                ],
            },
        ])
        expect(result).toBe("Valid")
    })

    it("filters non-text blocks in concatenation", () => {
        const result = extractTaskFromApiHistory([
            {
                role: "user",
                content: [
                    { type: "image", source: { media_type: "image/png" } },
                    { type: "text", text: "<user_message>task</user_message>" },
                ],
            },
        ])
        expect(result).toBe("task")
    })

    it("returns null for turn without content array", () => {
        expect(
            extractTaskFromApiHistory([{ role: "user" }]),
        ).toBeNull()
    })
})
