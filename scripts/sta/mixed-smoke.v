module mixed_top (
    input wire A,
    input wire B,
    input wire CK,
    output wire Y,
    output wire Z
);
    wire kept_and;
    wire kept_and2;

    // Both instances are already mapped and must remain untouched.
    sky130_fd_sc_hd__and2_1 U_KEEP (
        .A(A),
        .B(B),
        .X(kept_and)
    );
    sky130_fd_sc_hd__and2_1 U_KEEP2 (
        .A(A),
        .B(CK),
        .X(kept_and2)
    );

    // These expressions are RTL and must be synthesized and mapped.
    assign Y = kept_and ^ kept_and2;
    assign Z = kept_and | B;
endmodule
