module fpga_playground (
    input wire A,
    input wire B,
    output wire Y
);
    (* keep = 1 *) wire AND1_out;
    and AND1 (AND1_out, A, B);
    assign Y = AND1_out;
endmodule
