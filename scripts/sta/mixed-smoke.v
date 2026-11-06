module mixed_top (
    input wire A,
    input wire B,
    input wire CK,
    output wire Y,
    output wire Z
);
    wire kept_and;

    // This instance is already mapped and must remain untouched.
    sky130_fd_sc_hd__and2_1 U_KEEP (
        .A(A),
        .B(B),
        .X(kept_and)
    );

    // These expressions are RTL and must be synthesized and mapped.
    assign Y = kept_and ^ CK;
    assign Z = A | B;
endmodule
